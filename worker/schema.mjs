export function initialize(sql, concepts, mode) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS studies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, join_hash TEXT NOT NULL,
      consent_url TEXT NOT NULL, consent_version TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS concepts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, subcategory TEXT NOT NULL,
      total INTEGER NOT NULL, male INTEGER NOT NULL, female INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, study_id TEXT NOT NULL, neptun TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      demographics TEXT NOT NULL, gender TEXT NOT NULL, consent_version TEXT NOT NULL,
      created_at TEXT NOT NULL, completed_at TEXT, abandoned_at TEXT,
      UNIQUE(study_id, neptun)
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, concept_id TEXT NOT NULL,
      category TEXT NOT NULL, subcategory TEXT NOT NULL, ordinal INTEGER NOT NULL,
      overflow INTEGER NOT NULL, relaxed INTEGER NOT NULL, assigned_at TEXT NOT NULL,
      completed_at TEXT, UNIQUE(session_id, category), UNIQUE(session_id, ordinal)
    );
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, text TEXT NOT NULL, saved_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assignment_session ON assignments(session_id);
    CREATE INDEX IF NOT EXISTS feature_assignment ON features(assignment_id);
  `);
  if (!sql.exec("SELECT value FROM metadata WHERE key='seed_mode'").toArray().length) {
    if (!['zero', 'completed'].includes(mode)) throw new Error('SEED_MODE must be zero or completed');
    for (const c of concepts) {
      const male = mode === 'completed' ? c.baseline_male : 0;
      const female = mode === 'completed' ? c.baseline_female : 0;
      sql.exec('INSERT INTO concepts VALUES (?,?,?,?,?,?,?)', c.id, c.name, c.category, c.subcategory, male + female, male, female);
    }
    sql.exec("INSERT INTO metadata VALUES ('seed_mode',?)", mode);
  }
}
