// What each kind of report is, for its card (the owner's wish, 2026-11-16: a description, not the list of sections).
// Used by the Reports page (public/reports.js) and by the copy of the list made for the phone (phone-shelf.js).
export const ABOUT = [
  [/pattern/i, 'Rooted in your own design, your Pattern shows your natural gifts and your challenges as one whole: you are the Sovran Self, already whole, perfect and complete, with nothing to fix. It opens a way of living from that wholeness, meeting every part of yourself as it is and following the knowing that has always been inside you.'],
  [/layered-portrait|portrait/i, 'One page that grows with you: each part of the Sovran Quest adds a layer.'],
];
export const aboutOf = (r) => r.description || ABOUT.find(([match]) => match.test(`${r.report} ${r.title}`))?.[1] || '';
