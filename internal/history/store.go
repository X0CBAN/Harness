package history

import (
	"database/sql"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// Entry represents a single HTTP request/response pair.
type Entry struct {
	ID              int64     `json:"id"`
	Timestamp       time.Time `json:"timestamp"`
	Method          string    `json:"method"`
	Host            string    `json:"host"`
	URL             string    `json:"url"`
	RequestHeaders  string    `json:"requestHeaders"`
	RequestBody     string    `json:"requestBody"`
	StatusCode      int       `json:"statusCode"`
	ResponseHeaders string    `json:"responseHeaders"`
	ResponseBody    string    `json:"responseBody"`
	ResponseLength  int       `json:"responseLength"`
	DurationMs      int64     `json:"durationMs"`
	MimeType        string    `json:"mimeType"`
	InScope         bool      `json:"inScope"`
}

// Store is the SQLite-backed history store.
type Store struct {
	db *sql.DB
}

// New opens (or creates) the SQLite DB at the given path.
func New(path string) (*Store, error) {
	db, err := sql.Open("sqlite3", path+"?_journal_mode=WAL")
	if err != nil {
		return nil, err
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS history (
			id               INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp        DATETIME DEFAULT CURRENT_TIMESTAMP,
			method           TEXT NOT NULL,
			host             TEXT NOT NULL,
			url              TEXT NOT NULL,
			request_headers  TEXT,
			request_body     TEXT,
			status_code      INTEGER,
			response_headers TEXT,
			response_body    TEXT,
			response_length  INTEGER,
			duration_ms      INTEGER,
			mime_type        TEXT,
			in_scope         BOOLEAN DEFAULT TRUE
		);
		CREATE INDEX IF NOT EXISTS idx_history_host ON history(host);
		CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);

		CREATE TABLE IF NOT EXISTS crawl_nodes (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			url         TEXT NOT NULL,
			method      TEXT NOT NULL DEFAULT 'GET',
			parent_id   INTEGER REFERENCES crawl_nodes(id),
			depth       INTEGER NOT NULL DEFAULT 0,
			status_code INTEGER,
			found_at    DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_crawl_url ON crawl_nodes(url);
	`)
	return err
}

// CrawlNode is a node discovered by the crawler.
type CrawlNode struct {
	ID         int64  `json:"id"`
	URL        string `json:"url"`
	Method     string `json:"method"`
	ParentID   *int64 `json:"parentId"`
	Depth      int    `json:"depth"`
	StatusCode int    `json:"statusCode"`
	FoundAt    string `json:"foundAt"`
}

// AddCrawlNode inserts a crawl node and returns its ID.
func (s *Store) AddCrawlNode(nodeURL, method string, parentID *int64, depth, statusCode int) (int64, error) {
	res, err := s.db.Exec(
		`INSERT INTO crawl_nodes (url, method, parent_id, depth, status_code) VALUES (?, ?, ?, ?, ?)`,
		nodeURL, method, parentID, depth, statusCode,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// GetCrawlNodes returns all crawl nodes ordered by id.
func (s *Store) GetCrawlNodes() ([]*CrawlNode, error) {
	rows, err := s.db.Query(
		`SELECT id, url, method, parent_id, depth, status_code, found_at FROM crawl_nodes ORDER BY id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var nodes []*CrawlNode
	for rows.Next() {
		n := &CrawlNode{}
		if err := rows.Scan(&n.ID, &n.URL, &n.Method, &n.ParentID, &n.Depth, &n.StatusCode, &n.FoundAt); err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, nil
}

// ClearCrawlNodes deletes all crawl nodes.
func (s *Store) ClearCrawlNodes() error {
	_, err := s.db.Exec("DELETE FROM crawl_nodes")
	return err
}

// Add inserts a new entry and returns its ID.
func (s *Store) Add(e *Entry) (int64, error) {
	res, err := s.db.Exec(`
		INSERT INTO history (method, host, url, request_headers, request_body,
			status_code, response_headers, response_body, response_length,
			duration_ms, mime_type, in_scope)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.Method, e.Host, e.URL, e.RequestHeaders, e.RequestBody,
		e.StatusCode, e.ResponseHeaders, e.ResponseBody, e.ResponseLength,
		e.DurationMs, e.MimeType, e.InScope,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// List returns entries filtered by optional search term, ordered newest-first.
func (s *Store) List(search string, limit, offset int) ([]*Entry, error) {
	query := `
		SELECT id, timestamp, method, host, url, request_headers, request_body,
			status_code, response_headers, response_body, response_length,
			duration_ms, mime_type, in_scope
		FROM history
		WHERE (? = '' OR host LIKE '%'||?||'%' OR url LIKE '%'||?||'%' OR method = ?)
		ORDER BY id DESC
		LIMIT ? OFFSET ?`

	rows, err := s.db.Query(query, search, search, search, search, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []*Entry
	for rows.Next() {
		e := &Entry{}
		err := rows.Scan(
			&e.ID, &e.Timestamp, &e.Method, &e.Host, &e.URL,
			&e.RequestHeaders, &e.RequestBody, &e.StatusCode,
			&e.ResponseHeaders, &e.ResponseBody, &e.ResponseLength,
			&e.DurationMs, &e.MimeType, &e.InScope,
		)
		if err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, nil
}

// Get returns a single entry by ID.
func (s *Store) Get(id int64) (*Entry, error) {
	e := &Entry{}
	err := s.db.QueryRow(`
		SELECT id, timestamp, method, host, url, request_headers, request_body,
			status_code, response_headers, response_body, response_length,
			duration_ms, mime_type, in_scope
		FROM history WHERE id = ?`, id,
	).Scan(
		&e.ID, &e.Timestamp, &e.Method, &e.Host, &e.URL,
		&e.RequestHeaders, &e.RequestBody, &e.StatusCode,
		&e.ResponseHeaders, &e.ResponseBody, &e.ResponseLength,
		&e.DurationMs, &e.MimeType, &e.InScope,
	)
	return e, err
}

// Clear deletes all history entries.
func (s *Store) Clear() error {
	_, err := s.db.Exec("DELETE FROM history")
	return err
}

// Close closes the database connection.
func (s *Store) Close() error {
	return s.db.Close()
}
