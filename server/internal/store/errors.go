package store

import "errors"

// ErrNotFound is returned when an asset id names nothing on disk. ErrInvalid is returned when a save is
// refused for a bad field. The HTTP layer maps them to 404 and 400.
var (
	ErrNotFound = errors.New("asset not found")
	ErrInvalid  = errors.New("invalid asset")
)
