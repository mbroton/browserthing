package scheduler

import (
	"fmt"
	"regexp"
)

// DefaultPool is the pool of workers and sessions that do not name a pool.
const DefaultPool = "default"

var poolPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// ParsePool returns the pool that a request names. An empty value means
// DefaultPool. A name has 1 to 63 lowercase letters, digits, and hyphens, and
// starts and ends with a letter or digit.
func ParsePool(value string) (string, error) {
	if value == "" {
		return DefaultPool, nil
	}
	if !poolPattern.MatchString(value) {
		return "", fmt.Errorf(
			"invalid pool name %q: use 1 to 63 lowercase letters, digits, and hyphens, "+
				"and start and end with a letter or digit",
			value,
		)
	}
	return value, nil
}
