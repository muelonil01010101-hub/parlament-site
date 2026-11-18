CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT, d TEXT, t TEXT, b TEXT);
CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, nick TEXT, role TEXT, d TEXT, bio TEXT, mkey TEXT);
CREATE TABLE IF NOT EXISTS apps (id INTEGER PRIMARY KEY AUTOINCREMENT, d TEXT, nick TEXT, contact TEXT, about TEXT, status TEXT DEFAULT 'new', code TEXT);
CREATE TABLE IF NOT EXISTS sessions (tok TEXT PRIMARY KEY, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ach (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER, title TEXT);
CREATE TABLE IF NOT EXISTS polls (id INTEGER PRIMARY KEY AUTOINCREMENT, q TEXT, d TEXT, closed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS opts (id INTEGER PRIMARY KEY AUTOINCREMENT, poll_id INTEGER, t TEXT);
CREATE TABLE IF NOT EXISTS votes (id INTEGER PRIMARY KEY AUTOINCREMENT, poll_id INTEGER, member_id INTEGER, opt_id INTEGER, UNIQUE(poll_id, member_id));
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS admin_auth (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, n INTEGER NOT NULL, since INTEGER NOT NULL);
INSERT OR IGNORE INTO kv (k,v) VALUES ('rules','["Уважайте других участников клана.","Никаких оскорблений и спама в чате.","Заходите в игру хотя бы раз в неделю.","Решения лидеров клана не обсуждаются в общем чате.","Помогайте новичкам — мы все с чего-то начинали."]');

INSERT INTO news (d,t,b) SELECT date('now'),'Сайт клана запущен','Добро пожаловать! Здесь будут новости, правила и набор в клан.' WHERE NOT EXISTS (SELECT 1 FROM news);
CREATE TABLE IF NOT EXISTS rate_limits (k TEXT PRIMARY KEY, n INTEGER NOT NULL, since INTEGER NOT NULL);
