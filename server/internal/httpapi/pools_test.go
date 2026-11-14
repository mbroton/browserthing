package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"

	"server/internal/db/data"
	"server/internal/relay"
)

func TestServer_WorkerPoolRegistration(t *testing.T) {
	pool := newMigratedTestPool(t)
	queries := data.New(pool)
	server := New(pool, queries, NoAuthAuthenticator{}, testLogger(io.Discard))

	register := func(fields map[string]any) *httptest.ResponseRecorder {
		body := map[string]any{
			"address":            "ws://worker-" + uuid.NewString() + ":3000",
			"browser":            "chromium",
			"playwright_version": "1.62.1",
			"max_slots":          2,
		}
		for key, value := range fields {
			body[key] = value
		}
		return requestJSON(t, server.Handler, http.MethodPost, "/internal/workers", body, "")
	}

	for _, test := range []struct {
		name   string
		fields map[string]any
		want   string
	}{
		{name: "without pool", fields: nil, want: "default"},
		{name: "empty pool", fields: map[string]any{"pool": ""}, want: "default"},
		{name: "named pool", fields: map[string]any{"pool": "long-eu"}, want: "long-eu"},
	} {
		t.Run(test.name, func(t *testing.T) {
			truncateTables(t, pool)
			response := register(test.fields)
			if response.Code != http.StatusCreated {
				t.Fatalf("register status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
			}
			var worker Worker
			decodeJSON(t, response.Body.Bytes(), &worker)
			if worker.Pool != test.want {
				t.Fatalf("registered worker pool = %q, want %q", worker.Pool, test.want)
			}
			list := requestJSON(t, server.Handler, http.MethodGet, "/v1/workers", nil, "")
			var workers []Worker
			decodeJSON(t, list.Body.Bytes(), &workers)
			if len(workers) != 1 || workers[0].Pool != test.want {
				t.Fatalf("listed workers = %+v, want one worker in pool %q", workers, test.want)
			}
		})
	}

	t.Run("invalid pool", func(t *testing.T) {
		truncateTables(t, pool)
		for _, name := range []string{"Long", "-long", "long_eu", strings.Repeat("x", 64)} {
			response := register(map[string]any{"pool": name})
			if response.Code != http.StatusUnprocessableEntity ||
				!strings.Contains(response.Body.String(), "invalid pool name") {
				t.Fatalf("pool %q response = %d %s, want 422 invalid pool name", name, response.Code, response.Body.String())
			}
		}
		workers, err := queries.ListWorkers(t.Context())
		if err != nil || len(workers) != 0 {
			t.Fatalf("ListWorkers() = %+v, %v; want no workers", workers, err)
		}
	})
}

func TestServer_CreateSessionPool(t *testing.T) {
	pool := newMigratedTestPool(t)
	queries := data.New(pool)
	defaultWorker := insertTestWorker(t, queries, data.WorkerStatusAvailable, 4)
	longWorker := insertTestWorker(t, queries, data.WorkerStatusAvailable, 4)
	setWorkerPool(t, pool, longWorker, "long")
	server := New(
		pool,
		queries,
		NoAuthAuthenticator{},
		testLogger(io.Discard),
		WithScheduler(newTestScheduler(pool, 0, time.Second)),
	)

	for _, test := range []struct {
		name       string
		body       map[string]any
		wantPool   string
		wantWorker uuid.UUID
	}{
		{name: "without pool", body: map[string]any{"browser": "chromium"}, wantPool: "default", wantWorker: defaultWorker},
		{name: "empty pool", body: map[string]any{"browser": "chromium", "pool": ""}, wantPool: "default", wantWorker: defaultWorker},
		{name: "named pool", body: map[string]any{"browser": "chromium", "pool": "long"}, wantPool: "long", wantWorker: longWorker},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := requestJSON(t, server.Handler, http.MethodPost, "/v1/sessions", test.body, "")
			if response.Code != http.StatusCreated {
				t.Fatalf("create status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
			}
			var session Session
			decodeJSON(t, response.Body.Bytes(), &session)
			if session.Pool != test.wantPool || session.WorkerID != test.wantWorker {
				t.Fatalf("session = pool %q worker %s, want pool %q worker %s",
					session.Pool, session.WorkerID, test.wantPool, test.wantWorker)
			}
			got := requestJSON(t, server.Handler, http.MethodGet, "/v1/sessions/"+session.ID.String(), nil, "")
			var stored Session
			decodeJSON(t, got.Body.Bytes(), &stored)
			if stored.Pool != test.wantPool {
				t.Fatalf("GET session pool = %q, want %q", stored.Pool, test.wantPool)
			}
		})
	}

	t.Run("pool without workers", func(t *testing.T) {
		response := requestJSON(t, server.Handler, http.MethodPost, "/v1/sessions", map[string]any{
			"browser": "chromium",
			"pool":    "fast",
		}, "")
		if response.Code != http.StatusTooManyRequests {
			t.Fatalf("missing pool status = %d, want %d: %s", response.Code, http.StatusTooManyRequests, response.Body.String())
		}
	})

	t.Run("invalid pool", func(t *testing.T) {
		response := requestJSON(t, server.Handler, http.MethodPost, "/v1/sessions", map[string]any{
			"browser": "chromium",
			"pool":    "Long",
		}, "")
		if response.Code != http.StatusUnprocessableEntity ||
			!strings.Contains(response.Body.String(), `invalid pool name \"Long\"`) {
			t.Fatalf("invalid pool response = %d %s, want 422 invalid pool name", response.Code, response.Body.String())
		}
	})
}

func TestServer_CapacityByPool(t *testing.T) {
	pool := newMigratedTestPool(t)
	queries := data.New(pool)
	insertTestWorker(t, queries, data.WorkerStatusAvailable, 2)
	longWorker := insertTestWorker(t, queries, data.WorkerStatusAvailable, 3)
	setWorkerPool(t, pool, longWorker, "long")
	server := New(
		pool,
		queries,
		NoAuthAuthenticator{},
		testLogger(io.Discard),
		WithScheduler(newTestScheduler(pool, 7, time.Second)),
	)
	created := requestJSON(t, server.Handler, http.MethodPost, "/v1/sessions", map[string]any{
		"browser": "chromium",
		"pool":    "long",
	}, "")
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", created.Code, created.Body.String())
	}

	response := requestJSON(t, server.Handler, http.MethodGet, "/v1/capacity", nil, "")
	var capacity Capacity
	decodeJSON(t, response.Body.Bytes(), &capacity)
	want := []BrowserCapacity{
		{Pool: "default", Browser: "chromium", Workers: 1, MaxSlots: 2, ActiveSessions: 0, AvailableSlots: 2},
		{Pool: "long", Browser: "chromium", Workers: 1, MaxSlots: 3, ActiveSessions: 1, AvailableSlots: 2},
	}
	if len(capacity.Browsers) != len(want) || capacity.Browsers[0] != want[0] || capacity.Browsers[1] != want[1] {
		t.Fatalf("capacity browsers = %+v, want %+v", capacity.Browsers, want)
	}
	if capacity.Totals != (CapacityTotals{Workers: 2, MaxSlots: 5, ActiveSessions: 1, AvailableSlots: 4}) ||
		capacity.MaxQueueSize != 7 {
		t.Fatalf("capacity = %+v, want totals over both pools and one queue limit", capacity)
	}
}

func TestRelay_Pools(t *testing.T) {
	pool := newMigratedTestPool(t)
	queries := data.New(pool)

	t.Run("connect routes by pool", func(t *testing.T) {
		truncateTables(t, pool)
		defaultEcho := newEchoWorker(t)
		longEcho := newEchoWorker(t)
		defaultWorker := insertRelayWorker(t, queries, defaultEcho.wsURL(), "chromium", "1.62.1", 4)
		longWorker := insertRelayWorker(t, queries, longEcho.wsURL(), "chromium", "1.62.1", 4)
		setWorkerPool(t, pool, longWorker, "long")
		logger := testLogger(io.Discard)
		manager := newTestRelayManager(queries, logger, relay.Options{})
		server := newRelayHTTPServer(t, pool, NoAuthAuthenticator{}, manager, logger, 0)

		for _, test := range []struct {
			query      string
			echo       *echoWorker
			wantWorker uuid.UUID
			wantPool   string
		}{
			{query: "", echo: defaultEcho, wantWorker: defaultWorker, wantPool: "default"},
			{query: "?pool=", echo: defaultEcho, wantWorker: defaultWorker, wantPool: "default"},
			{query: "?pool=long", echo: longEcho, wantWorker: longWorker, wantPool: "long"},
		} {
			client, _, err := websocket.DefaultDialer.Dial(wsURL(server.URL)+"/"+test.query, nil)
			if err != nil {
				t.Fatalf("dial %q returned an error: %v", test.query, err)
			}
			assertMessage(t, client, []byte("worker-ready"))
			session := latestSession(t, pool, queries)
			if session.WorkerID != test.wantWorker || session.Pool != test.wantPool {
				t.Fatalf("dial %q session = worker %s pool %q, want worker %s pool %q",
					test.query, session.WorkerID, session.Pool, test.wantWorker, test.wantPool)
			}
			closeWebSocket(t, client, websocket.CloseNormalClosure, "done")
			_ = receiveClose(t, test.echo, session.ID)
		}
	})

	t.Run("invalid pool gets bad request", func(t *testing.T) {
		truncateTables(t, pool)
		worker := newEchoWorker(t)
		insertRelayWorker(t, queries, worker.wsURL(), "chromium", "1.62.1", 1)
		logger := testLogger(io.Discard)
		manager := newTestRelayManager(queries, logger, relay.Options{})
		server := newRelayHTTPServer(t, pool, NoAuthAuthenticator{}, manager, logger, 0)
		_, response, err := websocket.DefaultDialer.Dial(wsURL(server.URL)+"/?pool=Long_EU", nil)
		if err == nil || response == nil || response.StatusCode != http.StatusBadRequest {
			t.Fatalf("invalid pool response = %v, error = %v; want 400", response, err)
		}
		body, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if !strings.Contains(string(body), `invalid pool name \"Long_EU\"`) {
			t.Fatalf("invalid pool body = %s, want invalid pool name message", body)
		}
		if got := worker.upgrades.Load(); got != 0 {
			t.Fatalf("worker upgrades = %d, want 0", got)
		}
	})

	t.Run("queue timeout names the requested pool", func(t *testing.T) {
		truncateTables(t, pool)
		worker := newEchoWorker(t)
		insertRelayWorker(t, queries, worker.wsURL(), "chromium", "1.62.1", 1)
		logger := testLogger(io.Discard)
		manager := newTestRelayManager(queries, logger, relay.Options{})
		server := newRelayHTTPServer(t, pool, NoAuthAuthenticator{}, manager, logger, 10)
		want := "session queue wait timed out: no worker serves chromium in pool long; " +
			"registered workers: chromium 1.62.1 in pool default"
		_, response, err := websocket.DefaultDialer.Dial(wsURL(server.URL)+"/?pool=long", nil)
		if err == nil || response == nil || response.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("missing pool response = %v, error = %v; want 503", response, err)
		}
		body, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if !strings.Contains(string(body), want) {
			t.Fatalf("missing pool body = %s, want %q", body, want)
		}
		if got := worker.upgrades.Load(); got != 0 {
			t.Fatalf("worker upgrades = %d, want 0", got)
		}
	})

	t.Run("dial failure does not move a session to another pool", func(t *testing.T) {
		truncateTables(t, pool)
		failedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "not a WebSocket worker", http.StatusServiceUnavailable)
		}))
		t.Cleanup(failedServer.Close)
		failedWorker := insertRelayWorker(t, queries, wsURL(failedServer.URL), "chromium", "1.62.1", 1)
		setWorkerPool(t, pool, failedWorker, "long")
		other := newEchoWorker(t)
		insertRelayWorker(t, queries, other.wsURL(), "chromium", "1.62.1", 4)
		logger := testLogger(io.Discard)
		manager := newTestRelayManager(queries, logger, relay.Options{})
		server := newRelayHTTPServer(t, pool, NoAuthAuthenticator{}, manager, logger, 0)

		_, response, err := websocket.DefaultDialer.Dial(wsURL(server.URL)+"/?pool=long", nil)
		if err == nil || response == nil || response.StatusCode != http.StatusBadGateway {
			t.Fatalf("failed pool worker response = %v, error = %v; want 502", response, err)
		}
		_ = response.Body.Close()
		if got := other.upgrades.Load(); got != 0 {
			t.Fatalf("default worker upgrades = %d, want 0", got)
		}
		session := latestSession(t, pool, queries)
		if session.WorkerID != failedWorker || session.Pool != "long" || session.Status != data.SessionStatusFailed {
			t.Fatalf("session = %+v, want failed session in pool long on %s", session, failedWorker)
		}
	})
}

func setWorkerPool(t *testing.T, pool *pgxpool.Pool, workerID uuid.UUID, name string) {
	t.Helper()
	if _, err := pool.Exec(t.Context(), "UPDATE workers SET pool = $2 WHERE id = $1", workerID, name); err != nil {
		t.Fatalf("setting worker pool: %v", err)
	}
}
