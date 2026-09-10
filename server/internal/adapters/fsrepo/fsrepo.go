// Package fsrepo is the disk-backed Repository.
//
// An asset is two files under the data directory: a metadata JSON (<id>.json) and a payload
// (<id>.<format>, e.g. a glb model or a png texture). Keeping the payload as an ordinary file — not a blob
// inside the JSON — is deliberate: a glTF model or a texture is exactly the file wowd's three.js client
// will load, so it can be served byte-for-byte and, later, copied straight into the game's asset directory
// without a conversion step. The metadata is small and human-readable so a designer (or a diff) can see
// what an id means.
//
// Every write is atomic (AGENTS.md, invariant 10): the studio holds hours of a designer's work, and a file
// half-written when the process dies is the worst bug it could have.
package fsrepo

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/snow-ghost/asset-studio/server/internal/domain"
)

// Repo reads and writes assets under a single directory.
type Repo struct {
	dir string
}

// New opens (creating if needed) a repository rooted at dir.
func New(dir string) (*Repo, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("fsrepo: create %s: %w", dir, err)
	}
	return &Repo{dir: dir}, nil
}

const metaExt = ".json"

// tmpMark is in the name of every temporary file, so a directory listing can tell one from an asset file
// no matter what suffix the target has.
const tmpMark = ".tmp-"

func (r *Repo) metaPath(id string) string { return filepath.Join(r.dir, id+metaExt) }

// payloadPath trusts its arguments: the id has passed domain.ValidID and the format domain.KnownFormat
// before anything reaches the repository, so neither can carry a path.
func (r *Repo) payloadPath(id, format string) string { return filepath.Join(r.dir, id+"."+format) }

func (r *Repo) List() ([]domain.Asset, error) {
	entries, err := os.ReadDir(r.dir)
	if err != nil {
		return nil, fmt.Errorf("fsrepo: list: %w", err)
	}
	out := make([]domain.Asset, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, metaExt) || strings.Contains(name, tmpMark) {
			continue
		}
		a, err := r.Get(strings.TrimSuffix(name, metaExt))
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

func (r *Repo) Get(id string) (domain.Asset, error) {
	if !domain.ValidID(id) {
		// An id that is not a safe file name names nothing, by construction: nothing with such a name was
		// ever written. Reporting it as not found rather than invalid also means the answer does not depend
		// on whether the caller was probing.
		return domain.Asset{}, fmt.Errorf("fsrepo: %w: bad id %q", domain.ErrNotFound, id)
	}
	raw, err := os.ReadFile(r.metaPath(id))
	if err != nil {
		if os.IsNotExist(err) {
			return domain.Asset{}, fmt.Errorf("fsrepo: %w: %s", domain.ErrNotFound, id)
		}
		return domain.Asset{}, fmt.Errorf("fsrepo: read %s: %w", id, err)
	}
	var a domain.Asset
	if err := json.Unmarshal(raw, &a); err != nil {
		return domain.Asset{}, fmt.Errorf("fsrepo: parse %s: %w", id, err)
	}
	return a, nil
}

func (r *Repo) Payload(id string) ([]byte, error) {
	a, err := r.Get(id)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(r.payloadPath(a.ID, a.Format))
	if err != nil {
		return nil, fmt.Errorf("fsrepo: read payload %s: %w", id, err)
	}
	return raw, nil
}

// Put writes the payload first and the metadata second, so <id>.json never points at a payload that is not
// there yet. Any payload of another format left from an earlier save is removed afterwards.
func (r *Repo) Put(a domain.Asset, payload []byte) error {
	if payload != nil {
		if err := writeAtomic(r.payloadPath(a.ID, a.Format), payload); err != nil {
			return fmt.Errorf("fsrepo: write payload %s: %w", a.ID, err)
		}
	}
	meta, err := json.MarshalIndent(a, "", "  ")
	if err != nil {
		return fmt.Errorf("fsrepo: marshal %s: %w", a.ID, err)
	}
	if err := writeAtomic(r.metaPath(a.ID), meta); err != nil {
		return fmt.Errorf("fsrepo: write meta %s: %w", a.ID, err)
	}
	return r.removeOthers(a.ID, a.ID+metaExt, a.ID+"."+a.Format)
}

func (r *Repo) Delete(id string) error {
	if _, err := r.Get(id); err != nil {
		return err
	}
	return r.removeOthers(id)
}

// removeOthers deletes every file of an asset except the names to keep. Scanning the directory rather than
// computing the one old path means a format changed twice, or a crash between two writes, cannot leave a
// stray payload behind.
func (r *Repo) removeOthers(id string, keep ...string) error {
	entries, err := os.ReadDir(r.dir)
	if err != nil {
		return fmt.Errorf("fsrepo: list: %w", err)
	}
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, id+".") || strings.Contains(name, tmpMark) {
			continue
		}
		if slicesContains(keep, name) {
			continue
		}
		if err := os.Remove(filepath.Join(r.dir, name)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("fsrepo: remove %s: %w", name, err)
		}
	}
	return nil
}

func slicesContains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}

// writeAtomic writes data to path so that a reader never sees a partial file and a crash leaves either the
// old file or the new one: the bytes go to a temporary file in the same directory, are synced to disk, and
// are renamed over the target — an atomic replacement on POSIX file systems.
func writeAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+tmpMark+"*")
	if err != nil {
		return err
	}
	if err := fill(tmp, data); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	return nil
}

// fill writes the bytes, makes them durable and the file readable, and closes it; the caller decides
// whether the file then becomes the asset or is thrown away.
func fill(f *os.File, data []byte) error {
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	// CreateTemp makes the file private; assets are shared local data, readable like any other file.
	return os.Chmod(f.Name(), 0o644)
}
