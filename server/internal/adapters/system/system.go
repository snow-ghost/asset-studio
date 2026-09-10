// Package system is the studio's contact with the operating system for the two things the domain refuses to
// know on its own (AGENTS.md, invariant 4): what time it is and how to mint an id.
package system

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

// Clock is the wall clock, in UTC so a timestamp means the same thing on every machine that reads it.
type Clock struct{}

func (Clock) Now() time.Time { return time.Now().UTC() }

// IDs mints 16 hex characters from 8 random bytes: short enough to read in a file listing, wide enough that a
// collision in one studio's lifetime is not a practical concern.
type IDs struct{}

func (IDs) New() string {
	var b [8]byte
	_, _ = rand.Read(b[:]) // crypto/rand does not fail on a healthy system; a panic here would be noise
	return hex.EncodeToString(b[:])
}
