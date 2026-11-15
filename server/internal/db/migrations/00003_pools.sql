-- +goose Up
ALTER TABLE workers ADD COLUMN pool text NOT NULL DEFAULT 'default';
ALTER TABLE sessions ADD COLUMN pool text NOT NULL DEFAULT 'default';

-- +goose Down
ALTER TABLE sessions DROP COLUMN pool;
ALTER TABLE workers DROP COLUMN pool;
