package scheduler

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"server/internal/db/data"
)

func TestParsePool(t *testing.T) {
	valid := map[string]string{
		"":                      "default",
		"default":               "default",
		"long":                  "long",
		"a":                     "a",
		"7":                     "7",
		"long-eu":               "long-eu",
		"2-fast":                "2-fast",
		strings.Repeat("x", 63): strings.Repeat("x", 63),
	}
	for value, want := range valid {
		got, err := ParsePool(value)
		if err != nil || got != want {
			t.Fatalf("ParsePool(%q) = %q, %v; want %q, nil", value, got, err, want)
		}
	}
	for _, value := range []string{
		"Long", "-long", "long-", "-", "long_eu", "long eu", "long.eu", "lóng",
		strings.Repeat("x", 64),
	} {
		if _, err := ParsePool(value); err == nil {
			t.Fatalf("ParsePool(%q) returned no error", value)
		}
	}
}

func TestScheduler_Pools(t *testing.T) {
	pool := newMigratedTestPool(t)
	queries := data.New(pool)

	t.Run("request without pool claims only default workers", func(t *testing.T) {
		truncate(t, pool)
		defaultWorker := insertWorker(t, pool, queries, workerSpec{maxSlots: 1})
		insertWorker(t, pool, queries, workerSpec{pool: "long", maxSlots: 4, lifetimeSessions: 20})
		sessionScheduler := newTestScheduler(pool, 0, 50)

		session, err := sessionScheduler.Claim(t.Context(), ClaimRequest{Browser: "chromium"})
		if err != nil {
			t.Fatalf("Claim() returned an error: %v", err)
		}
		if session.WorkerID != defaultWorker || session.Pool != "default" {
			t.Fatalf("Claim() = worker %s pool %q, want default worker %s in pool default",
				session.WorkerID, session.Pool, defaultWorker)
		}
		if _, err := sessionScheduler.Claim(t.Context(), ClaimRequest{Browser: "chromium"}); !errors.Is(err, ErrNoCapacity) {
			t.Fatalf("Claim() with full default pool error = %v, want %v", err, ErrNoCapacity)
		}
	})

	t.Run("request for a named pool claims only workers in that pool", func(t *testing.T) {
		truncate(t, pool)
		insertWorker(t, pool, queries, workerSpec{maxSlots: 4, lifetimeSessions: 20})
		insertWorker(t, pool, queries, workerSpec{pool: "fast", maxSlots: 4, lifetimeSessions: 20})
		longWorker := insertWorker(t, pool, queries, workerSpec{pool: "long", maxSlots: 1})
		sessionScheduler := newTestScheduler(pool, 0, 50)

		session, err := sessionScheduler.Claim(t.Context(), ClaimRequest{Pool: "long", Browser: "chromium"})
		if err != nil {
			t.Fatalf("Claim() returned an error: %v", err)
		}
		if session.WorkerID != longWorker || session.Pool != "long" {
			t.Fatalf("Claim() = worker %s pool %q, want long worker %s in pool long",
				session.WorkerID, session.Pool, longWorker)
		}
		_, err = sessionScheduler.Claim(t.Context(), ClaimRequest{Pool: "long", Browser: "chromium"})
		if !errors.Is(err, ErrNoCapacity) {
			t.Fatalf("Claim() with full long pool error = %v, want %v", err, ErrNoCapacity)
		}
	})

	t.Run("request for a pool without workers never claims a default worker", func(t *testing.T) {
		truncate(t, pool)
		insertWorker(t, pool, queries, workerSpec{maxSlots: 4})
		_, err := newTestScheduler(pool, 0, 50).Claim(t.Context(), ClaimRequest{Pool: "long", Browser: "chromium"})
		if !errors.Is(err, ErrNoCapacity) {
			t.Fatalf("Claim() error = %v, want %v", err, ErrNoCapacity)
		}
	})

	t.Run("a full pool does not delay requests for another pool", func(t *testing.T) {
		truncate(t, pool)
		longWorker := insertWorker(t, pool, queries, workerSpec{pool: "long", maxSlots: 1})
		defaultWorker := insertWorker(t, pool, queries, workerSpec{maxSlots: 1})
		fastWorker := insertWorker(t, pool, queries, workerSpec{pool: "fast", maxSlots: 1})
		sessionScheduler := newOrderTestScheduler(pool)
		held, err := sessionScheduler.Claim(t.Context(), ClaimRequest{Pool: "long", Browser: "chromium"})
		if err != nil {
			t.Fatalf("Claim() returned an error: %v", err)
		}
		admitted := make(chan orderAdmission, 1)
		startOrderedAdmit(
			t,
			sessionScheduler,
			t.Context(),
			ClaimRequest{Pool: "long", Browser: "chromium"},
			0,
			admitted,
		)
		waitForQueueDepth(t, sessionScheduler, 1)

		for _, test := range []struct {
			request ClaimRequest
			want    uuid.UUID
		}{
			{request: ClaimRequest{Browser: "chromium"}, want: defaultWorker},
			{request: ClaimRequest{Pool: "fast", Browser: "chromium"}, want: fastWorker},
		} {
			request, want := test.request, test.want
			ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
			started := time.Now()
			session, err := sessionScheduler.Admit(ctx, request)
			cancel()
			if err != nil {
				t.Fatalf("Admit(%+v) returned an error: %v", request, err)
			}
			if session.WorkerID != want {
				t.Fatalf("Admit(%+v).WorkerID = %s, want %s", request, session.WorkerID, want)
			}
			if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
				t.Fatalf("Admit(%+v) took %s while another pool was full", request, elapsed)
			}
		}
		waitForQueueDepth(t, sessionScheduler, 1)
		assertNoAdmission(t, admitted)

		failAndWake(t, queries, sessionScheduler, held.ID)
		queued := nextAdmission(t, admitted)
		if queued.err != nil {
			t.Fatalf("queued Admit() returned an error: %v", queued.err)
		}
		if queued.session.WorkerID != longWorker {
			t.Fatalf("queued Admit().WorkerID = %s, want long worker %s", queued.session.WorkerID, longWorker)
		}
	})

	t.Run("reassignment stays in the session pool", func(t *testing.T) {
		truncate(t, pool)
		failedWorker := insertWorker(t, pool, queries, workerSpec{pool: "long", lifetimeSessions: 30})
		insertWorker(t, pool, queries, workerSpec{lifetimeSessions: 50, maxSlots: 4})
		replacement := insertWorker(t, pool, queries, workerSpec{pool: "long"})
		sessionScheduler := newTestScheduler(pool, 0, 100)
		claimed, err := sessionScheduler.Claim(t.Context(), ClaimRequest{Pool: "long", Browser: "chromium"})
		if err != nil {
			t.Fatalf("Claim() returned an error: %v", err)
		}
		if claimed.WorkerID != failedWorker {
			t.Fatalf("Claim().WorkerID = %s, want %s", claimed.WorkerID, failedWorker)
		}
		if _, err := queries.StartSession(t.Context(), claimed.ID); err != nil {
			t.Fatalf("StartSession() returned an error: %v", err)
		}

		reassigned, err := sessionScheduler.Reassign(t.Context(), claimed.ID, []uuid.UUID{failedWorker})
		if err != nil {
			t.Fatalf("Reassign() returned an error: %v", err)
		}
		if reassigned.WorkerID != replacement || reassigned.Pool != "long" {
			t.Fatalf("Reassign() = worker %s pool %q, want long worker %s in pool long",
				reassigned.WorkerID, reassigned.Pool, replacement)
		}

		_, err = sessionScheduler.Reassign(t.Context(), claimed.ID, []uuid.UUID{failedWorker, replacement})
		if !errors.Is(err, ErrNoCapacity) {
			t.Fatalf("Reassign() with only a default worker free error = %v, want %v", err, ErrNoCapacity)
		}
	})

	t.Run("capacity reports each pool and browser", func(t *testing.T) {
		truncate(t, pool)
		insertWorker(t, pool, queries, workerSpec{maxSlots: 2})
		longChromium := insertWorker(t, pool, queries, workerSpec{pool: "long", maxSlots: 3})
		insertWorker(t, pool, queries, workerSpec{pool: "long", browser: "firefox", maxSlots: 1})
		insertSession(t, pool, queries, longChromium, data.SessionStatusRunning)

		capacity, err := newTestScheduler(pool, 4, 50).Capacity(t.Context())
		if err != nil {
			t.Fatalf("Capacity() returned an error: %v", err)
		}
		want := []data.GetCapacityByPoolAndBrowserRow{
			{Pool: "default", Browser: "chromium", Workers: 1, MaxSlots: 2, ActiveSessions: 0, AvailableSlots: 2},
			{Pool: "long", Browser: "chromium", Workers: 1, MaxSlots: 3, ActiveSessions: 1, AvailableSlots: 2},
			{Pool: "long", Browser: "firefox", Workers: 1, MaxSlots: 1, ActiveSessions: 0, AvailableSlots: 1},
		}
		if len(capacity.Browsers) != len(want) {
			t.Fatalf("Capacity().Browsers = %+v, want %+v", capacity.Browsers, want)
		}
		for i := range want {
			if capacity.Browsers[i] != want[i] {
				t.Fatalf("Capacity().Browsers = %+v, want %+v", capacity.Browsers, want)
			}
		}
	})
}
