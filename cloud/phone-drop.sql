-- The phone drop box (module phone-drop), kept in the Sovran cloud database. A student's phone leaves a note here,
-- already scrambled on the phone; their app on their computer collects it about once a minute and deletes it.
-- Nothing here can be read without the key that only the student's phone and computer have, and the tokens are
-- kept only as their SHA-256 hashes. The schema is not offered to the web API; only the phone-drop function uses it.

CREATE SCHEMA IF NOT EXISTS phone_drop;
REVOKE ALL ON SCHEMA phone_drop FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA phone_drop FROM anon, authenticated'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS phone_drop.boxes (
  box          text PRIMARY KEY CHECK (box ~ '^[A-Za-z0-9_-]{22}$'),
  drop_hash    text NOT NULL CHECK (drop_hash ~ '^[0-9a-f]{64}$'), -- the phone's token, hashed: it may only leave notes
  pull_hash    text NOT NULL CHECK (pull_hash ~ '^[0-9a-f]{64}$'), -- the computer's token, hashed: collect and close
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_drop_at timestamptz,
  last_pull_at timestamptz
);

CREATE TABLE IF NOT EXISTS phone_drop.notes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  box        text NOT NULL REFERENCES phone_drop.boxes (box) ON DELETE CASCADE,
  sealed     text NOT NULL CHECK (length(sealed) <= 170000 AND sealed ~ '^[A-Za-z0-9_-]+$'), -- scrambled on the phone
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_box ON phone_drop.notes (box, id);
-- Boxes made before thoughts could be 20,000 characters: widen the old 24,000 limit (safe to run again).
ALTER TABLE phone_drop.notes DROP CONSTRAINT IF EXISTS notes_sealed_check;
ALTER TABLE phone_drop.notes ADD CONSTRAINT notes_sealed_check CHECK (length(sealed) <= 170000 AND sealed ~ '^[A-Za-z0-9_-]+$');
ALTER TABLE phone_drop.boxes ENABLE ROW LEVEL SECURITY; -- no policies: nobody but the function's owner role gets in
ALTER TABLE phone_drop.notes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION phone_drop.hash(token text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT encode(sha256(convert_to(coalesce(token, ''), 'UTF8')), 'hex') $$;

-- A new box. Limits keep the free database safe from someone making boxes in bulk.
-- Old things are cleared here too: notes nobody collected in 90 days, boxes not used in 180 days.
CREATE OR REPLACE FUNCTION phone_drop.open_box(p_box text, p_drop_hash text, p_pull_hash text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM phone_drop.notes WHERE created_at < now() - interval '90 days';
  DELETE FROM phone_drop.boxes WHERE coalesce(last_pull_at, created_at) < now() - interval '180 days';
  IF (SELECT count(*) FROM phone_drop.boxes WHERE created_at > now() - interval '1 hour') >= 60 THEN RETURN 'busy'; END IF;
  IF (SELECT count(*) FROM phone_drop.boxes) >= 5000 THEN RETURN 'full'; END IF;
  INSERT INTO phone_drop.boxes (box, drop_hash, pull_hash) VALUES (p_box, p_drop_hash, p_pull_hash);
  RETURN 'ok';
EXCEPTION WHEN unique_violation OR check_violation THEN RETURN 'refused';
END $$;

-- A note from the phone: 'ok', 'unknown' (no such box, or a wrong token), 'full' or 'refused' (not a sealed note).
CREATE OR REPLACE FUNCTION phone_drop.drop_note(p_box text, p_drop text, p_sealed text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM phone_drop.boxes WHERE box = p_box AND drop_hash = phone_drop.hash(p_drop) FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF (SELECT count(*) FROM phone_drop.notes WHERE box = p_box) >= 200 THEN RETURN 'full'; END IF;
  IF (SELECT count(*) FROM phone_drop.notes) >= 5000 THEN RETURN 'full'; END IF;
  INSERT INTO phone_drop.notes (box, sealed) VALUES (p_box, p_sealed);
  UPDATE phone_drop.boxes SET last_drop_at = now() WHERE box = p_box;
  RETURN 'ok';
EXCEPTION WHEN check_violation THEN RETURN 'refused';
END $$;

-- What waits for the computer, oldest first (at most 50 at a time). NULL: no such box, or a wrong token.
CREATE OR REPLACE FUNCTION phone_drop.take_notes(p_box text, p_pull text) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE phone_drop.boxes SET last_pull_at = now() WHERE box = p_box AND pull_hash = phone_drop.hash(p_pull);
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'sealed', sealed, 'created_at', created_at) ORDER BY id)
    FROM (SELECT id, sealed, created_at FROM phone_drop.notes WHERE box = p_box ORDER BY id LIMIT 50) n), '[]'::jsonb);
END $$;

-- The computer has kept these: they are deleted. Returns how many, or -1 for a wrong token.
CREATE OR REPLACE FUNCTION phone_drop.done_notes(p_box text, p_pull text, p_ids bigint[]) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE gone integer;
BEGIN
  PERFORM 1 FROM phone_drop.boxes WHERE box = p_box AND pull_hash = phone_drop.hash(p_pull);
  IF NOT FOUND THEN RETURN -1; END IF;
  DELETE FROM phone_drop.notes WHERE box = p_box AND id = ANY (p_ids);
  GET DIAGNOSTICS gone = ROW_COUNT;
  RETURN gone;
END $$;

-- The box and everything in it, gone (a new link, or phone capture switched off). false: wrong token.
CREATE OR REPLACE FUNCTION phone_drop.close_box(p_box text, p_pull text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM phone_drop.boxes WHERE box = p_box AND pull_hash = phone_drop.hash(p_pull);
  RETURN FOUND;
END $$;

-- ---- Keep this chat saved (the Sovran Library's save tool, cloud/library-save/) ----
-- A student's computer registers a public key against their library key. The Sovran Library (library-mcp) seals a
-- saved chat to that key and leaves it in the same box as the phone's notes; only that computer can open it.
-- One row per student: the box of the computer that registered last.
CREATE TABLE IF NOT EXISTS phone_drop.savers (
  student_id text PRIMARY KEY,                               -- library.student_for_key(...).id
  box        text NOT NULL UNIQUE REFERENCES phone_drop.boxes (box) ON DELETE CASCADE,
  public_key text NOT NULL CHECK (public_key ~ '^[A-Za-z0-9_-]{87}$'), -- P-256, raw, base64url; the private key stays on the computer
  created_at timestamptz NOT NULL DEFAULT now(),
  hour_from  timestamptz NOT NULL DEFAULT now(),             -- the hour being counted, for the limit below
  hour_saves integer NOT NULL DEFAULT 0
);
ALTER TABLE phone_drop.savers ENABLE ROW LEVEL SECURITY; -- no policies

-- The computer registers (or replaces) its public key: 'ok', 'unknown' (no such box, or a wrong token),
-- 'nokey' (not a library key in use) or 'refused' (not a public key).
CREATE OR REPLACE FUNCTION phone_drop.register_saver(p_box text, p_pull text, p_key_hash text, p_public text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_student text;
BEGIN
  PERFORM 1 FROM phone_drop.boxes WHERE box = p_box AND pull_hash = phone_drop.hash(p_pull);
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  SELECT id INTO v_student FROM library.student_for_key(p_key_hash);
  IF v_student IS NULL THEN RETURN 'nokey'; END IF;
  DELETE FROM phone_drop.savers WHERE box = p_box AND student_id <> v_student;
  INSERT INTO phone_drop.savers (student_id, box, public_key) VALUES (v_student, p_box, p_public)
    ON CONFLICT (student_id) DO UPDATE SET box = excluded.box, public_key = excluded.public_key;
  RETURN 'ok';
EXCEPTION WHEN check_violation THEN RETURN 'refused';
END $$;

-- For library-mcp, which runs as library_reader with the student set for its transaction (library.student_id):
-- the student's registered public key, or NULL when their computer has not registered one.
CREATE OR REPLACE FUNCTION phone_drop.saver_key() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS
$$ SELECT public_key FROM phone_drop.savers WHERE student_id = nullif(current_setting('library.student_id', true), '') $$;

-- A sealed part of a saved chat, left in the student's box: 'ok', 'none' (no computer registered), 'busy' (more
-- than 120 saves in the hour), 'full' (as for the phone) or 'refused' (not sealed text).
CREATE OR REPLACE FUNCTION phone_drop.save_note(p_sealed text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s phone_drop.savers%ROWTYPE;
BEGIN
  SELECT * INTO s FROM phone_drop.savers WHERE student_id = nullif(current_setting('library.student_id', true), '') FOR UPDATE;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  IF s.hour_from < now() - interval '1 hour' THEN s.hour_from := now(); s.hour_saves := 0; END IF;
  IF s.hour_saves >= 120 THEN RETURN 'busy'; END IF;
  IF (SELECT count(*) FROM phone_drop.notes WHERE box = s.box) >= 200 THEN RETURN 'full'; END IF;
  IF (SELECT count(*) FROM phone_drop.notes) >= 5000 THEN RETURN 'full'; END IF;
  INSERT INTO phone_drop.notes (box, sealed) VALUES (s.box, p_sealed);
  UPDATE phone_drop.savers SET hour_from = s.hour_from, hour_saves = s.hour_saves + 1 WHERE student_id = s.student_id;
  UPDATE phone_drop.boxes SET last_drop_at = now() WHERE box = s.box;
  RETURN 'ok';
EXCEPTION WHEN check_violation THEN RETURN 'refused';
END $$;

-- ---- The shelf: My reports on Sovran Go (phone-shelf.js) ----
-- What the phone may read: the student's computer puts sealed copies here (their reports, their highlights and
-- comments), sealed with the same key as the phone's notes, which only the phone and the computer have. The phone
-- reads them with its drop token; nobody else can read a word. At most 12 things per box, each replaced in place.
CREATE TABLE IF NOT EXISTS phone_drop.shelf (
  box        text NOT NULL REFERENCES phone_drop.boxes (box) ON DELETE CASCADE,
  name       text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9.-]{0,79}$'),
  sealed     text NOT NULL CHECK (length(sealed) <= 1400000 AND sealed ~ '^[A-Za-z0-9_-]+$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (box, name)
);
ALTER TABLE phone_drop.shelf ENABLE ROW LEVEL SECURITY; -- no policies

-- The computer puts (or replaces) one thing on its shelf; NULL or '' takes it off. 'ok', 'unknown' (no such box, or
-- a wrong token), 'full' (12 things already) or 'refused' (not sealed text, or not a name).
CREATE OR REPLACE FUNCTION phone_drop.put_shelf(p_box text, p_pull text, p_name text, p_sealed text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM phone_drop.boxes WHERE box = p_box AND pull_hash = phone_drop.hash(p_pull) FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF coalesce(p_sealed, '') = '' THEN DELETE FROM phone_drop.shelf WHERE box = p_box AND name = p_name; RETURN 'ok'; END IF;
  IF NOT EXISTS (SELECT 1 FROM phone_drop.shelf WHERE box = p_box AND name = p_name)
     AND (SELECT count(*) FROM phone_drop.shelf WHERE box = p_box) >= 12 THEN RETURN 'full'; END IF;
  INSERT INTO phone_drop.shelf (box, name, sealed) VALUES (p_box, p_name, p_sealed)
    ON CONFLICT (box, name) DO UPDATE SET sealed = excluded.sealed, updated_at = now();
  RETURN 'ok';
EXCEPTION WHEN check_violation THEN RETURN 'refused';
END $$;

-- The phone reads its shelf: every name with when it last changed, and the sealed text of those it does not have
-- yet (p_have: { name: the updated_at the phone holds }). NULL: no such box, or a wrong token.
CREATE OR REPLACE FUNCTION phone_drop.read_shelf(p_box text, p_drop text, p_have jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM phone_drop.boxes WHERE box = p_box AND drop_hash = phone_drop.hash(p_drop);
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('name', name, 'updated_at', updated_at)
      || CASE WHEN coalesce(p_have ->> name, '') = (to_jsonb(updated_at) #>> '{}') THEN '{}'::jsonb ELSE jsonb_build_object('sealed', sealed) END ORDER BY name)
    FROM phone_drop.shelf WHERE box = p_box), '[]'::jsonb);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA phone_drop FROM PUBLIC;
-- library-mcp's role may use those two functions and nothing else here (the tables have no policies for it).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'library_reader') THEN
    GRANT USAGE ON SCHEMA phone_drop TO library_reader;
    GRANT EXECUTE ON FUNCTION phone_drop.saver_key(), phone_drop.save_note(text) TO library_reader;
  END IF;
END $$;
