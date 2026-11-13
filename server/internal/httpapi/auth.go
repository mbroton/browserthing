package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"server/internal/db/data"
)

var (
	errUnauthorized = errors.New("httpapi: unauthorized")
	errAuthBackend  = errors.New("httpapi: authentication backend unavailable")
)

type Principal struct {
	KeyID *uuid.UUID
}

type principalContextKey struct{}

func PrincipalFromContext(ctx context.Context) Principal {
	principal, _ := ctx.Value(principalContextKey{}).(Principal)
	return principal
}

type Authenticator interface {
	Authenticate(ctx context.Context, authorization string) (Principal, error)
}

type NoAuthAuthenticator struct{}

func (NoAuthAuthenticator) Authenticate(context.Context, string) (Principal, error) {
	return Principal{}, nil
}

type TokenAuthenticator struct {
	queries *data.Queries
	logger  *slog.Logger
}

func NewTokenAuthenticator(queries *data.Queries, logger *slog.Logger) *TokenAuthenticator {
	return &TokenAuthenticator{
		queries: queries,
		logger:  logger,
	}
}

// NewAuthenticator returns the authenticator for the server's configuration and
// logs a warning when the server accepts no requests or accepts every request.
func NewAuthenticator(
	ctx context.Context,
	disabled bool,
	queries *data.Queries,
	logger *slog.Logger,
) (Authenticator, error) {
	if disabled {
		logger.Warn(
			"authentication is disabled by AUTH_DISABLED=true; every client that can reach the server has full access. Use this only for local development",
		)
		return NoAuthAuthenticator{}, nil
	}
	count, err := queries.CountActiveAPIKeys(ctx)
	if err != nil {
		return nil, fmt.Errorf("counting active api keys: %w", err)
	}
	if count == 0 {
		logger.Warn(
			"no active api keys exist; the server refuses api and relay requests with 401 until you create one",
			"create_key", "server apikey create --name <name>",
		)
	}
	return NewTokenAuthenticator(queries, logger), nil
}

func (a *TokenAuthenticator) Authenticate(ctx context.Context, authorization string) (Principal, error) {
	token, ok := bearerToken(authorization)
	if !ok {
		return Principal{}, errUnauthorized
	}

	digest := sha256.Sum256([]byte(token))
	key, err := a.queries.GetActiveAPIKeyByHash(ctx, hex.EncodeToString(digest[:]))
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, errUnauthorized
	}
	if err != nil {
		return Principal{}, fmt.Errorf("%w: looking up api key: %w", errAuthBackend, err)
	}
	if err := a.queries.TouchAPIKey(ctx, key.ID); err != nil {
		a.logger.Warn("touch api key", "key_id", key.ID, "error", err)
	}

	keyID := key.ID
	return Principal{KeyID: &keyID}, nil
}

func bearerToken(authorization string) (string, bool) {
	scheme, token, ok := strings.Cut(authorization, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	if !strings.HasPrefix(token, "pwd_") || len(token) == len("pwd_") || strings.ContainsAny(token, " \t\r\n") {
		return "", false
	}
	return token, true
}
