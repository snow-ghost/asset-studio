package bdd

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/cucumber/godog"

	"github.com/snow-ghost/asset-studio/server/internal/adapters/fsrepo"
	"github.com/snow-ghost/asset-studio/server/internal/adapters/httpapi"
	"github.com/snow-ghost/asset-studio/server/internal/adapters/system"
	"github.com/snow-ghost/asset-studio/server/internal/app"
	"github.com/snow-ghost/asset-studio/server/internal/domain"
)

// tickingClock hands out a time that moves one second forward on every call. The suite does not sleep
// (AGENTS.md, section 7): "newest first" and "updated later than created" are asserted against a clock the
// scenario owns, so they cannot flake on a fast machine and cannot pass by accident on a slow one.
type tickingClock struct{ now time.Time }

func (c *tickingClock) Now() time.Time {
	c.now = c.now.Add(time.Second)
	return c.now
}

// state is one scenario's world: a studio in its own sandbox directory, what the designer has saved so far
// under the names a scenario uses, and the last answer the studio gave.
//
// Scenarios talk to the studio the way the frontend does — through the HTTP handler, in process, with no
// socket — on top of the real disk repository in a sandbox directory, because the files on disk
// (<id>.json beside <id>.<format>, nothing outside the data directory) are part of what M0 promises. Time
// comes from a clock the suite owns; ids from the production source, since no scenario predicts one. The
// use cases themselves have table tests against memrepo in internal/app.
type state struct {
	// root is the sandbox; the data directory is root/data, so a write that escapes the data directory
	// lands inside root where a step can see it, instead of somewhere in the real /tmp.
	root string
	dir  string
	mux  *http.ServeMux

	named    map[string]domain.Asset // by the name a scenario uses
	payloads map[string][]byte       // current payload by asset id
	previous map[string][]byte       // payload before the last re-save, by asset id
	revs     map[string]int          // payload revisions per name, so each payload is distinct

	// The last answer.
	status int
	header http.Header
	body   []byte

	// Decoded views of answers, filled by the step that asked.
	asset    domain.Asset
	before   domain.Asset // the asset as it was before the last re-save
	current  domain.Asset // the asset the last payload request was about
	list     []domain.Asset
	manifest domain.Manifest
	entry    domain.ManifestEntry
}

func newState() *state {
	return &state{
		named:    map[string]domain.Asset{},
		payloads: map[string][]byte{},
		previous: map[string][]byte{},
		revs:     map[string]int{},
	}
}

func (s *state) start(cors string, maxPayload int64) error {
	root, err := os.MkdirTemp("", "studio-bdd-")
	if err != nil {
		return err
	}
	s.root = root
	s.dir = filepath.Join(root, "data")
	repo, err := fsrepo.New(s.dir)
	if err != nil {
		return err
	}
	clock := &tickingClock{now: time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)}
	s.mux = http.NewServeMux()
	httpapi.New(app.New(repo, clock, system.IDs{}), cors, maxPayload).Register(s.mux)
	return nil
}

func (s *state) cleanup() {
	if s.root != "" {
		_ = os.RemoveAll(s.root)
	}
}

// saveBody mirrors the JSON the frontend sends (httpapi.saveRequest).
type saveBody struct {
	ID      string   `json:"id,omitempty"`
	Name    string   `json:"name"`
	Kind    string   `json:"kind"`
	Format  string   `json:"format"`
	Tags    []string `json:"tags,omitempty"`
	WowdRef string   `json:"wowdRef,omitempty"`
	Data    string   `json:"data,omitempty"`
}

// do sends one request to the studio and keeps the answer.
func (s *state) do(method, path string, body any, hdr map[string]string) error {
	if s.mux == nil {
		return fmt.Errorf("no studio is running: the scenario needs a Given that starts one")
	}
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(raw)
	}
	req := httptest.NewRequestWithContext(context.Background(), method, path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	s.status = rec.Code
	s.header = rec.Header()
	s.body = rec.Body.Bytes()
	return nil
}

// payloadFor makes a payload that is distinct per asset and per revision and contains bytes outside
// ASCII, so that a byte-for-byte comparison means something: plain text surviving base64 and the disk
// would prove nothing about a real glb.
func payloadFor(name string, rev int) []byte {
	b := []byte(fmt.Sprintf("payload of %q rev %d ", name, rev))
	return append(b, 0x00, 0xFF, 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x7F)
}

func (s *state) assetPath(id string) string { return "/api/assets/" + url.PathEscape(id) }

func (s *state) mustNamed(name string) (domain.Asset, error) {
	a, ok := s.named[name]
	if !ok {
		return domain.Asset{}, fmt.Errorf("no asset named %q was saved in this scenario", name)
	}
	return a, nil
}

// bigPayload makes a payload of exactly n bytes with a repeating non-text pattern, for the scenarios about
// the size limit: the content does not matter there, the length does.
func bigPayload(n int64) []byte {
	out := make([]byte, n)
	for i := range out {
		out[i] = byte(i%251) ^ 0xA5
	}
	return out
}

// save creates an asset with the next revision of its payload. precondition says whether a refusal is a
// broken Given (fail now) or the thing the scenario is about (leave it for the Then).
func (s *state) save(kind, name, format, ref, chosenID string, precondition bool) error {
	return s.create(kind, name, format, ref, chosenID, payloadFor(name, s.revs[name]+1), precondition)
}

// create is save with an explicit payload.
func (s *state) create(kind, name, format, ref, chosenID string, payload []byte, precondition bool) error {
	rev := s.revs[name] + 1
	body := saveBody{ID: chosenID, Name: name, Kind: kind, Format: format, WowdRef: ref,
		Data: base64.StdEncoding.EncodeToString(payload)}
	if err := s.do(http.MethodPost, "/api/assets", body, nil); err != nil {
		return err
	}
	if s.status != http.StatusOK {
		if precondition {
			return fmt.Errorf("saving %q was refused: %d %s", name, s.status, s.body)
		}
		return nil
	}
	if err := json.Unmarshal(s.body, &s.asset); err != nil {
		return fmt.Errorf("decode saved asset: %w", err)
	}
	s.named[name] = s.asset
	s.revs[name] = rev
	s.payloads[s.asset.ID] = payload
	return nil
}

// resave updates an existing asset with PUT. mod edits the request the way the scenario says; the next
// revision of the payload is attached when withPayload is set.
func (s *state) resave(name string, withPayload bool, mod func(*saveBody)) error {
	var payload []byte
	if withPayload {
		payload = payloadFor(name, s.revs[name]+1)
	}
	return s.resaveWith(name, payload, mod)
}

// resaveWith is resave with an explicit payload; nil means a metadata-only update. A refused re-save records
// nothing, so "the original payload" a later step asks about is still the one that is stored.
func (s *state) resaveWith(name string, payload []byte, mod func(*saveBody)) error {
	a, err := s.mustNamed(name)
	if err != nil {
		return err
	}
	s.before = a
	body := saveBody{Name: a.Name, Kind: string(a.Kind), Format: a.Format, Tags: a.Tags, WowdRef: a.WowdRef}
	rev := s.revs[name]
	if payload != nil {
		rev++
		body.Data = base64.StdEncoding.EncodeToString(payload)
	}
	mod(&body)
	if err := s.do(http.MethodPut, s.assetPath(a.ID), body, nil); err != nil {
		return err
	}
	if s.status != http.StatusOK {
		return nil
	}
	if err := json.Unmarshal(s.body, &s.asset); err != nil {
		return fmt.Errorf("decode updated asset: %w", err)
	}
	if payload != nil {
		s.previous[a.ID] = s.payloads[a.ID]
		s.payloads[a.ID] = payload
		s.revs[name] = rev
	}
	// A scenario may keep calling the asset by its old name or switch to the new one.
	s.named[name] = s.asset
	s.named[s.asset.Name] = s.asset
	return nil
}

func (s *state) fetchList() error {
	if err := s.do(http.MethodGet, "/api/assets", nil, nil); err != nil {
		return err
	}
	if s.status != http.StatusOK {
		return fmt.Errorf("listing assets: %d %s", s.status, s.body)
	}
	s.list = nil
	return json.Unmarshal(s.body, &s.list)
}

func (s *state) fetchPayload(a domain.Asset) error {
	s.current = a
	return s.do(http.MethodGet, s.assetPath(a.ID)+"/payload", nil, nil)
}

// dataFiles lists the file names in the data directory that belong to an asset id.
func (s *state) dataFiles(id string) ([]string, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), id+".") {
			out = append(out, e.Name())
		}
	}
	return out, nil
}

var quoted = regexp.MustCompile(`"([^"]*)"`)

// names extracts the quoted names from a step like `"a", "b", "c"`.
func names(list string) []string {
	var out []string
	for _, m := range quoted.FindAllStringSubmatch(list, -1) {
		out = append(out, m[1])
	}
	return out
}

func sameSet(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	seen := map[string]int{}
	for _, g := range got {
		seen[g]++
	}
	for _, w := range want {
		if seen[w] == 0 {
			return false
		}
		seen[w]--
	}
	return true
}

func registerStudioSteps(sc *godog.ScenarioContext, s *state) {
	// --- the studio ---
	sc.Step(`^an empty studio$`, func() error { return s.start("*", httpapi.DefaultMaxPayload) })
	sc.Step(`^a studio started in development mode$`, func() error { return s.start("*", httpapi.DefaultMaxPayload) })
	sc.Step(`^a studio started with CORS disabled$`, func() error { return s.start("", httpapi.DefaultMaxPayload) })
	sc.Step(`^a studio whose payload limit is (\d+) MiB$`, func(mib string) error {
		n, _ := strconv.ParseInt(mib, 10, 64)
		return s.start("*", n<<20)
	})

	// --- saving ---
	sc.Step(`^the designer (saves|has saved) an? (\S+) named "([^"]*)" as ?(\S*)$`,
		func(verb, kind, name, format string) error {
			return s.save(kind, name, format, "", "", verb == "has saved")
		})
	sc.Step(`^the designer (saves|has saved) an? (\S+) named "([^"]*)" as (\S+) bound to wowd id "([^"]*)"$`,
		func(verb, kind, name, format, ref string) error {
			return s.save(kind, name, format, ref, "", verb == "has saved")
		})
	sc.Step(`^the designer saves an? (\S+) named "([^"]*)" as (\S+) with a payload of exactly (\d+) MiB$`,
		func(kind, name, format, mib string) error {
			n, _ := strconv.ParseInt(mib, 10, 64)
			return s.create(kind, name, format, "", "", bigPayload(n<<20), false)
		})
	sc.Step(`^the designer saves "([^"]*)" again with a payload of (\d+) MiB plus one byte$`, func(name, mib string) error {
		n, _ := strconv.ParseInt(mib, 10, 64)
		return s.resaveWith(name, bigPayload(n<<20+1), func(*saveBody) {})
	})
	sc.Step(`^the designer saves an? (\S+) named "([^"]*)" without any payload$`, func(kind, name string) error {
		body := saveBody{Name: name, Kind: kind, Format: "glb"}
		return s.do(http.MethodPost, "/api/assets", body, nil)
	})
	sc.Step(`^the designer saves an? (\S+) named "([^"]*)" as (\S+) under the id "([^"]*)"$`,
		func(kind, name, format, id string) error {
			return s.save(kind, name, format, "", id, false)
		})
	sc.Step(`^the designer saves "([^"]*)" again with a new payload$`, func(name string) error {
		return s.resave(name, true, func(*saveBody) {})
	})
	sc.Step(`^the designer saves "([^"]*)" again as (\S+) with a new payload$`, func(name, format string) error {
		return s.resave(name, true, func(b *saveBody) { b.Format = format })
	})
	sc.Step(`^the designer renames "([^"]*)" to "([^"]*)" without touching its payload$`, func(name, to string) error {
		return s.resave(name, false, func(b *saveBody) { b.Name = to })
	})
	sc.Step(`^the designer changes "([^"]*)" to (\S+) without a new payload$`, func(name, format string) error {
		return s.resave(name, false, func(b *saveBody) { b.Format = format })
	})
	sc.Step(`^the designer unbinds "([^"]*)" from wowd$`, func(name string) error {
		return s.resave(name, false, func(b *saveBody) { b.WowdRef = "" })
	})

	// --- asking ---
	sc.Step(`^the designer opens "([^"]*)"$`, func(name string) error {
		a, err := s.mustNamed(name)
		if err != nil {
			return err
		}
		if err := s.do(http.MethodGet, s.assetPath(a.ID), nil, nil); err != nil {
			return err
		}
		if s.status == http.StatusOK {
			return json.Unmarshal(s.body, &s.asset)
		}
		return nil
	})
	sc.Step(`^the designer opens the asset "([^"]*)"$`, func(id string) error {
		return s.do(http.MethodGet, s.assetPath(id), nil, nil)
	})
	sc.Step(`^the designer opens the payload of "([^"]*)"$`, func(name string) error {
		a, err := s.mustNamed(name)
		if err != nil {
			return err
		}
		return s.fetchPayload(a)
	})
	sc.Step(`^the designer asks for the asset list$`, s.fetchList)
	sc.Step(`^the designer deletes "([^"]*)"$`, func(name string) error {
		a, err := s.mustNamed(name)
		if err != nil {
			return err
		}
		return s.do(http.MethodDelete, s.assetPath(a.ID), nil, nil)
	})
	sc.Step(`^the designer deletes the asset "([^"]*)"$`, func(id string) error {
		return s.do(http.MethodDelete, s.assetPath(id), nil, nil)
	})
	sc.Step(`^the game asks for the manifest$`, func() error {
		if err := s.do(http.MethodGet, "/api/manifest", nil, nil); err != nil {
			return err
		}
		if s.status != http.StatusOK {
			return fmt.Errorf("manifest: %d %s", s.status, s.body)
		}
		s.manifest = domain.Manifest{}
		return json.Unmarshal(s.body, &s.manifest)
	})
	sc.Step(`^the frontend asks permission to call the API from "([^"]*)"$`, func(origin string) error {
		return s.do(http.MethodOptions, "/api/assets", nil, map[string]string{
			"Origin":                        origin,
			"Access-Control-Request-Method": "POST",
		})
	})
	sc.Step(`^the studio is asked whether it is healthy$`, func() error {
		return s.do(http.MethodGet, "/api/healthz", nil, nil)
	})

	// --- what the studio answered: assets ---
	sc.Step(`^the asset is stored under a new id$`, func() error {
		if s.status != http.StatusOK {
			return fmt.Errorf("save answered %d %s", s.status, s.body)
		}
		if !regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`).MatchString(s.asset.ID) {
			return fmt.Errorf("id %q is not a safe file name", s.asset.ID)
		}
		for name, other := range s.named {
			if other.ID == s.asset.ID && name != s.asset.Name {
				return fmt.Errorf("id %q was already given to %q", s.asset.ID, name)
			}
		}
		for _, f := range []string{s.asset.ID + ".json", s.asset.ID + "." + s.asset.Format} {
			if _, err := os.Stat(filepath.Join(s.dir, f)); err != nil {
				return fmt.Errorf("expected %s in the data directory: %w", f, err)
			}
		}
		return nil
	})
	sc.Step(`^it is an? (\S+) in (\S+) format(?: named "([^"]*)")?$`, func(kind, format, name string) error {
		if string(s.asset.Kind) != kind || s.asset.Format != format {
			return fmt.Errorf("got %s/%s, want %s/%s", s.asset.Kind, s.asset.Format, kind, format)
		}
		if name != "" && s.asset.Name != name {
			return fmt.Errorf("got name %q, want %q", s.asset.Name, name)
		}
		return nil
	})
	sc.Step(`^the asset is named "([^"]*)"$`, func(name string) error {
		if s.status != http.StatusOK {
			return fmt.Errorf("answer was %d %s", s.status, s.body)
		}
		if s.asset.Name != name {
			return fmt.Errorf("got name %q, want %q", s.asset.Name, name)
		}
		return nil
	})
	sc.Step(`^the asset is in (\S+) format$`, func(format string) error {
		if s.status != http.StatusOK {
			return fmt.Errorf("answer was %d %s", s.status, s.body)
		}
		if s.asset.Format != format {
			return fmt.Errorf("got format %q, want %q", s.asset.Format, format)
		}
		return nil
	})
	sc.Step(`^the asset records the same creation and update time$`, func() error {
		if s.asset.CreatedAt.IsZero() || !s.asset.CreatedAt.Equal(s.asset.UpdatedAt) {
			return fmt.Errorf("created %v, updated %v", s.asset.CreatedAt, s.asset.UpdatedAt)
		}
		return nil
	})
	sc.Step(`^the asset keeps its id and creation time$`, func() error {
		if s.status != http.StatusOK {
			return fmt.Errorf("answer was %d %s", s.status, s.body)
		}
		if s.asset.ID != s.before.ID || !s.asset.CreatedAt.Equal(s.before.CreatedAt) {
			return fmt.Errorf("before %s@%v, after %s@%v", s.before.ID, s.before.CreatedAt, s.asset.ID, s.asset.CreatedAt)
		}
		return nil
	})
	sc.Step(`^its update time is later than its creation time$`, func() error {
		if !s.asset.UpdatedAt.After(s.asset.CreatedAt) {
			return fmt.Errorf("updated %v is not after created %v", s.asset.UpdatedAt, s.asset.CreatedAt)
		}
		return nil
	})
	sc.Step(`^opening (?:its payload|the payload of "([^"]*)") returns the (new|original) payload(?: as "([^"]*)")?$`,
		func(name, which, contentType string) error {
			a := s.asset
			if name != "" {
				var err error
				if a, err = s.mustNamed(name); err != nil {
					return err
				}
			}
			if err := s.fetchPayload(a); err != nil {
				return err
			}
			if s.status != http.StatusOK {
				return fmt.Errorf("payload answered %d %s", s.status, s.body)
			}
			want := s.payloads[a.ID]
			if which == "original" {
				if prev, ok := s.previous[a.ID]; ok {
					want = prev
				}
			}
			if !bytes.Equal(s.body, want) {
				return fmt.Errorf("payload differs: got %d bytes, want %d", len(s.body), len(want))
			}
			if contentType != "" && s.header.Get("Content-Type") != contentType {
				return fmt.Errorf("got Content-Type %q, want %q", s.header.Get("Content-Type"), contentType)
			}
			return nil
		})
	sc.Step(`^the payload is exactly what was saved$`, func() error {
		if s.status != http.StatusOK {
			return fmt.Errorf("payload answered %d %s", s.status, s.body)
		}
		if want := s.payloads[s.current.ID]; !bytes.Equal(s.body, want) {
			return fmt.Errorf("payload differs: got %d bytes, want %d", len(s.body), len(want))
		}
		return nil
	})
	sc.Step(`^it is served as "([^"]*)"$`, func(contentType string) error {
		if got := s.header.Get("Content-Type"); got != contentType {
			return fmt.Errorf("got Content-Type %q, want %q", got, contentType)
		}
		return nil
	})

	// --- what the studio answered: refusals and absences ---
	sc.Step(`^the save is refused as too large, naming the limit "([^"]*)"$`, func(limit string) error {
		if s.status != http.StatusRequestEntityTooLarge {
			return fmt.Errorf("expected a 413 refusal, got %d %.200s", s.status, s.body)
		}
		var e struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(s.body, &e); err != nil {
			return fmt.Errorf("refusal body is not {\"error\": …}: %.200s", s.body)
		}
		if !strings.Contains(e.Error, limit) {
			return fmt.Errorf("refused with %q, expected the limit %q to be named", e.Error, limit)
		}
		return nil
	})
	sc.Step(`^the save is refused because "([^"]*)"$`, func(reason string) error {
		if s.status != http.StatusBadRequest {
			return fmt.Errorf("expected a 400 refusal, got %d %s", s.status, s.body)
		}
		var e struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(s.body, &e); err != nil {
			return fmt.Errorf("refusal body is not {\"error\": …}: %s", s.body)
		}
		if !strings.Contains(e.Error, reason) {
			return fmt.Errorf("refused for %q, expected it to mention %q", e.Error, reason)
		}
		return nil
	})
	sc.Step(`^the studio still has no assets$`, func() error {
		if err := s.fetchList(); err != nil {
			return err
		}
		if len(s.list) != 0 {
			return fmt.Errorf("%d assets listed", len(s.list))
		}
		entries, err := os.ReadDir(s.dir)
		if err != nil {
			return err
		}
		if len(entries) != 0 {
			return fmt.Errorf("%d files in the data directory after a refused save", len(entries))
		}
		return nil
	})
	sc.Step(`^nothing was written outside the studio's data directory$`, func() error {
		return filepath.WalkDir(s.root, func(p string, _ fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if p == s.root || p == s.dir || strings.HasPrefix(p, s.dir+string(filepath.Separator)) {
				return nil
			}
			return fmt.Errorf("%s exists outside the data directory", p)
		})
	})
	sc.Step(`^the studio's data directory holds exactly one payload for it$`, func() error {
		files, err := s.dataFiles(s.asset.ID)
		if err != nil {
			return err
		}
		var payloads []string
		for _, f := range files {
			if !strings.HasSuffix(f, ".json") {
				payloads = append(payloads, f)
			}
		}
		if len(payloads) != 1 {
			return fmt.Errorf("payload files for %s: %v", s.asset.ID, payloads)
		}
		return nil
	})
	sc.Step(`^the studio's data directory holds no files for "([^"]*)"$`, func(name string) error {
		a, err := s.mustNamed(name)
		if err != nil {
			return err
		}
		files, err := s.dataFiles(a.ID)
		if err != nil {
			return err
		}
		if len(files) != 0 {
			return fmt.Errorf("files left for %s: %v", a.ID, files)
		}
		return nil
	})
	sc.Step(`^the deletion is confirmed$`, func() error {
		if s.status != http.StatusNoContent {
			return fmt.Errorf("delete answered %d %s", s.status, s.body)
		}
		return nil
	})
	sc.Step(`^opening "([^"]*)" answers not found$`, func(name string) error {
		a, err := s.mustNamed(name)
		if err != nil {
			return err
		}
		if err := s.do(http.MethodGet, s.assetPath(a.ID), nil, nil); err != nil {
			return err
		}
		if s.status != http.StatusNotFound {
			return fmt.Errorf("got %d %s", s.status, s.body)
		}
		return nil
	})
	sc.Step(`^the studio answers not found$`, func() error {
		if s.status != http.StatusNotFound {
			return fmt.Errorf("got %d %s", s.status, s.body)
		}
		return nil
	})

	// --- what the studio answered: lists ---
	sc.Step(`^the list holds (\d+) assets?$`, func(n string) error {
		want, _ := strconv.Atoi(n)
		if len(s.list) != want {
			return fmt.Errorf("list holds %d assets, want %d", len(s.list), want)
		}
		return nil
	})
	sc.Step(`^they are ordered (.+)$`, func(list string) error {
		want := names(list)
		var got []string
		for _, a := range s.list {
			got = append(got, a.Name)
		}
		if strings.Join(got, ",") != strings.Join(want, ",") {
			return fmt.Errorf("order is %v, want %v", got, want)
		}
		return nil
	})
	sc.Step(`^the asset list holds exactly (.+)$`, func(list string) error {
		if err := s.fetchList(); err != nil {
			return err
		}
		var got []string
		for _, a := range s.list {
			got = append(got, a.Name)
		}
		if want := names(list); !sameSet(got, want) {
			return fmt.Errorf("list holds %v, want %v", got, want)
		}
		return nil
	})

	// --- what the studio answered: the manifest ---
	sc.Step(`^the manifest is version (\d+)$`, func(v string) error {
		want, _ := strconv.Atoi(v)
		if s.manifest.Version != want {
			return fmt.Errorf("manifest version %d, want %d", s.manifest.Version, want)
		}
		return nil
	})
	sc.Step(`^it maps exactly the wowd ids (.+)$`, func(list string) error {
		var got []string
		for _, e := range s.manifest.Assets {
			got = append(got, e.WowdRef)
		}
		if want := names(list); !sameSet(got, want) {
			return fmt.Errorf("manifest maps %v, want %v", got, want)
		}
		return nil
	})
	sc.Step(`^it maps no wowd ids$`, func() error {
		if len(s.manifest.Assets) != 0 {
			return fmt.Errorf("manifest has %d entries", len(s.manifest.Assets))
		}
		var raw struct {
			Assets json.RawMessage `json:"assets"`
		}
		if err := json.Unmarshal(s.body, &raw); err != nil {
			return err
		}
		if string(bytes.TrimSpace(raw.Assets)) != "[]" {
			return fmt.Errorf(`manifest "assets" is %s, the game expects an empty list`, raw.Assets)
		}
		return nil
	})
	sc.Step(`^the entry for "([^"]*)" is an? (\S+) in (\S+) format named "([^"]*)"$`,
		func(ref, kind, format, name string) error {
			for _, e := range s.manifest.Assets {
				if e.WowdRef != ref {
					continue
				}
				s.entry = e
				if e.Kind != kind || e.Format != format || e.Name != name {
					return fmt.Errorf("entry %q is %s/%s %q, want %s/%s %q", ref, e.Kind, e.Format, e.Name, kind, format, name)
				}
				return nil
			}
			return fmt.Errorf("no manifest entry for %q", ref)
		})
	sc.Step(`^the entry for "([^"]*)" points at the payload of "([^"]*)"$`, func(ref, name string) error {
		a, err := s.mustNamed(name)
		if err != nil {
			return err
		}
		for _, e := range s.manifest.Assets {
			if e.WowdRef != ref {
				continue
			}
			s.entry = e
			if e.AssetID != a.ID || e.URL != "/api/assets/"+a.ID+"/payload" {
				return fmt.Errorf("entry %q has assetId %q url %q, want %q", ref, e.AssetID, e.URL, a.ID)
			}
			return nil
		}
		return fmt.Errorf("no manifest entry for %q", ref)
	})
	sc.Step(`^the game can fetch that payload$`, func() error {
		if err := s.do(http.MethodGet, s.entry.URL, nil, nil); err != nil {
			return err
		}
		if s.status != http.StatusOK {
			return fmt.Errorf("fetching %s answered %d", s.entry.URL, s.status)
		}
		if !bytes.Equal(s.body, s.payloads[s.entry.AssetID]) {
			return fmt.Errorf("the payload at %s is not what the designer saved", s.entry.URL)
		}
		return nil
	})

	// --- what the studio answered: dev mode ---
	sc.Step(`^the preflight is answered with no content$`, func() error {
		if s.status != http.StatusNoContent {
			return fmt.Errorf("preflight answered %d %s", s.status, s.body)
		}
		return nil
	})
	sc.Step(`^the answer allows any origin$`, func() error {
		if got := s.header.Get("Access-Control-Allow-Origin"); got != "*" {
			return fmt.Errorf("Access-Control-Allow-Origin is %q, want *", got)
		}
		return nil
	})
	sc.Step(`^the answer names no allowed origin$`, func() error {
		if got := s.header.Get("Access-Control-Allow-Origin"); got != "" {
			return fmt.Errorf("Access-Control-Allow-Origin is %q, want none", got)
		}
		return nil
	})
	sc.Step(`^it allows the methods "([^"]*)" and the header "([^"]*)"$`, func(methods, header string) error {
		if got := s.header.Get("Access-Control-Allow-Methods"); got != methods {
			return fmt.Errorf("Access-Control-Allow-Methods is %q, want %q", got, methods)
		}
		if got := s.header.Get("Access-Control-Allow-Headers"); got != header {
			return fmt.Errorf("Access-Control-Allow-Headers is %q, want %q", got, header)
		}
		return nil
	})
	sc.Step(`^it answers "([^"]*)"$`, func(text string) error {
		if s.status != http.StatusOK || strings.TrimSpace(string(s.body)) != text {
			return fmt.Errorf("got %d %q, want 200 %q", s.status, s.body, text)
		}
		return nil
	})
}
