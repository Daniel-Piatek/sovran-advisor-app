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
  sealed     text NOT NULL CHECK (length(sealed) <= 24000 AND sealed ~ '^[A-Za-z0-9_-]+$'), -- scrambled on the phone
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_box ON phone_drop.notes (box, id);
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

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA phone_drop FROM PUBLIC;
