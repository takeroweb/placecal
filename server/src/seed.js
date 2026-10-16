import crypto from 'node:crypto';

import { DEFAULT_CATEGORIES, DEFAULT_TEMPLATES } from './seed-data.js';

export { DEFAULT_CATEGORIES };

export function seedDefaults(db, userId) {
  const now = new Date().toISOString();
  const ids = {};
  const insC = db.prepare(`INSERT INTO categories (id,user_id,name,color,sort_order,created_at,updated_at)
                           VALUES (?,?,?,?,?,?,?)`);
  DEFAULT_CATEGORIES.forEach((c, i) => {
    ids[c.key] = crypto.randomUUID();
    insC.run(ids[c.key], userId, c.name, c.color, i, now, now);
  });
  const insT = db.prepare(`INSERT INTO templates (id,user_id,title,category_id,start_time,end_time,location,memo,
                           notification_minutes,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  DEFAULT_TEMPLATES.forEach((t, i) => {
    insT.run(crypto.randomUUID(), userId, t.title, ids[t.cat], t.start, t.end, t.location, '', null, i, now, now);
  });
}
