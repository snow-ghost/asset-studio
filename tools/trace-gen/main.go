// Command trace-gen builds the traceability matrix from the specifications, the Gherkin corpus and the
// browser specs, and fails when the chain has a hole.
//
// It exists to make invariant 2 of AGENTS.md enforceable rather than aspirational: every acceptance
// criterion of an active or closed spec must be covered by at least one scenario, and every scenario tag
// must point at a criterion that exists. Both directions matter — an uncovered criterion is untested
// work, and a tag pointing at nothing is a scenario that silently stopped testing what it claims to.
// The matrix is written before the verdict, so a failing run still leaves something readable.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var (
	// A criterion is defined by a spec table row whose first cell is exactly **REQ-NNN-x**. Prose that
	// mentions an id — a header note, a finding, an amendment — is not a definition; matching ids
	// anywhere in the text would invent criteria out of cross references and give them a line of prose
	// as their requirement.
	criterionCellRe = regexp.MustCompile(`^\*\*REQ-(\d{3})-(\d+)\*\*$`)
	// @req-000-1 as a scenario tag or a token in a browser spec. Lower case by Gherkin convention; the
	// identifier in prose is upper case.
	tagRe      = regexp.MustCompile(`@req-(\d{3})-(\d+)\b`)
	scenarioRe = regexp.MustCompile(`^\s*(?:Scenario Outline|Scenario|Example|Структура сценария|Сценарий):\s*(.+)$`)
	featureRe  = regexp.MustCompile(`^\s*(?:Feature|Функция):`)
	specDirRe  = regexp.MustCompile(`^(\d{3})-`)
	// test('title', …), test.skip('title', …), test.only(`title`, …) in a Playwright or Vitest spec.
	testTitleRe = regexp.MustCompile("test(?:\\.\\w+)?\\(\\s*['\"`]([^'\"`]+)['\"`]")
)

type criterion struct {
	id      string
	spec    string
	status  specStatus
	text    string
	covered []coverage
}

// specStatus is what a spec declares about itself in its `**Статус:**` line.
//
// The tool reads the status rather than hardcoding which milestone is current. A hardcoded milestone
// number is a second place to remember to update, and the one that gets forgotten: a closed spec would
// keep being treated as work in progress, and its uncovered criteria would stop failing the build exactly
// when they start mattering.
type specStatus int

const (
	statusDraft specStatus = iota
	statusActive
	statusClosed
)

func (s specStatus) String() string {
	switch s {
	case statusClosed:
		return "Closed"
	case statusActive:
		return "Active"
	default:
		return "Draft"
	}
}

// parseStatus reads the status line of a spec. An unrecognised or missing status is a draft: the
// permissive reading, because a spec nobody has classified yet is not something to fail a build over.
func parseStatus(body string) specStatus {
	for _, line := range strings.Split(body, "\n") {
		if !strings.Contains(line, "Статус:") && !strings.Contains(line, "Status:") {
			continue
		}
		switch {
		case strings.Contains(line, "Closed"), strings.Contains(line, "Закрыта"):
			return statusClosed
		case strings.Contains(line, "Active"), strings.Contains(line, "Активна"):
			return statusActive
		}
		return statusDraft
	}
	return statusDraft
}

// coverage is one thing that proves criteria: a Gherkin scenario, or a browser/unit spec.
type coverage struct {
	file     string
	scenario string
	tags     []string
}

// report is the outcome of one run: what the specs demand, what proves it, and what is missing.
type report struct {
	criteria  map[string]*criterion
	ordered   []string // criterion ids in numeric order
	scenarios int
	uncovered []string // criteria with no coverage, any status
	blocking  []string // uncovered criteria of active or closed specs — these fail the run
	orphans   []string // tags naming a criterion no spec defines — these fail the run too
}

func (r *report) holes() bool { return len(r.blocking) > 0 || len(r.orphans) > 0 }

func main() {
	root := flag.String("root", ".", "repository root")
	out := flag.String("out", filepath.Join("docs", "traceability.md"), "matrix file, relative to root")
	flag.Parse()

	r, err := build(*root)
	if err != nil {
		fail(err)
	}
	if len(r.criteria) == 0 {
		fail(fmt.Errorf("no acceptance criteria found under %s/specs", *root))
	}
	if err := r.write(filepath.Join(*root, *out)); err != nil {
		fail(err)
	}
	fmt.Printf("wrote %s: %d criteria, %d covering scenarios and specs\n", *out, len(r.ordered), r.scenarios)
	r.print()
	if r.holes() {
		os.Exit(1)
	}
}

// build reads the repository and attaches every piece of coverage to the criterion it names.
func build(root string) (*report, error) {
	criteria, err := collectCriteria(root)
	if err != nil {
		return nil, err
	}
	scenarios, err := collectScenarios(root)
	if err != nil {
		return nil, err
	}
	specs, err := collectWebSpecs(root)
	if err != nil {
		return nil, err
	}
	scenarios = append(scenarios, specs...)

	r := &report{criteria: criteria, scenarios: len(scenarios)}
	for _, sc := range scenarios {
		for _, tag := range sc.tags {
			id := strings.ToUpper(strings.TrimPrefix(tag, "@"))
			c, ok := criteria[id]
			if !ok {
				r.orphans = append(r.orphans, fmt.Sprintf("%s in %s (%s)", tag, sc.file, sc.scenario))
				continue
			}
			c.covered = append(c.covered, sc)
		}
	}
	sort.Strings(r.orphans)

	for id := range criteria {
		r.ordered = append(r.ordered, id)
	}
	sortIDs(r.ordered)
	for _, id := range r.ordered {
		c := criteria[id]
		if len(c.covered) > 0 {
			continue
		}
		r.uncovered = append(r.uncovered, id)
		// A draft is written before the code on purpose (invariant 1), so its holes are expected.
		// An active spec is the work in hand and a closed one is finished work: a hole in either is a
		// criterion nobody is testing, which is exactly what this tool is for.
		if c.status != statusDraft {
			r.blocking = append(r.blocking, id)
		}
	}
	return r, nil
}

func collectCriteria(root string) (map[string]*criterion, error) {
	out := map[string]*criterion{}
	specsDir := filepath.Join(root, "specs")
	entries, err := os.ReadDir(specsDir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		m := specDirRe.FindStringSubmatch(entry.Name())
		if !entry.IsDir() || m == nil {
			continue
		}
		specNo := m[1]
		body, err := os.ReadFile(filepath.Join(specsDir, entry.Name(), "spec.md"))
		if err != nil {
			continue // a spec directory without a spec.md is a stub, not an error
		}
		status := parseStatus(string(body))
		for _, line := range strings.Split(string(body), "\n") {
			no, num, text, ok := parseCriterionRow(line)
			// A spec defines only criteria carrying its own number. Anything else is a cross reference
			// and would be reported under the wrong milestone with the wrong status.
			if !ok || no != specNo {
				continue
			}
			id := fmt.Sprintf("REQ-%s-%s", no, num)
			if _, seen := out[id]; seen {
				continue
			}
			out[id] = &criterion{id: id, spec: specNo, status: status, text: text}
		}
	}
	return out, nil
}

// parseCriterionRow reads a markdown table row of the form `| **REQ-NNN-x** | requirement | … |`.
func parseCriterionRow(line string) (spec, num, text string, ok bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "|") {
		return "", "", "", false
	}
	cells := strings.Split(strings.Trim(trimmed, "|"), "|")
	if len(cells) < 2 {
		return "", "", "", false
	}
	m := criterionCellRe.FindStringSubmatch(strings.TrimSpace(cells[0]))
	if m == nil {
		return "", "", "", false
	}
	return m[1], m[2], strings.TrimSpace(cells[1]), true
}

func collectScenarios(root string) ([]coverage, error) {
	var out []coverage
	featuresDir := filepath.Join(root, "features")
	if _, err := os.Stat(featuresDir); os.IsNotExist(err) {
		return nil, nil
	}
	err := filepath.WalkDir(featuresDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || filepath.Ext(path) != ".feature" {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		out = append(out, parseFeature(rel, string(body))...)
		return nil
	})
	return out, err
}

// parseFeature lists the tagged scenarios of one feature file. Tags above the Feature line belong to
// every scenario in the file; tags below it belong to the scenario that follows them. Mixing the two
// up would attach the first scenario's tag to all of them and report phantom coverage.
func parseFeature(rel, body string) []coverage {
	var out []coverage
	var featureTags, pending []string
	beforeFeature := true
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "@"):
			tags := tagRe.FindAllString(trimmed, -1)
			if beforeFeature {
				featureTags = append(featureTags, tags...)
			} else {
				pending = append(pending, tags...)
			}
		case featureRe.MatchString(line):
			beforeFeature = false
		default:
			m := scenarioRe.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			tags := dedupe(append(append([]string{}, featureTags...), pending...))
			pending = nil
			if len(tags) > 0 {
				out = append(out, coverage{file: rel, scenario: strings.TrimSpace(m[1]), tags: tags})
			}
		}
	}
	return out
}

// collectWebSpecs scans web/tests for @req-NNN-x tokens, so a criterion proven by a Playwright or Vitest
// spec is covered as truly as one proven by Gherkin. The browser scenarios (@e2e) are executed there,
// not by godog (AGENTS.md, section 7); without this they would read as uncovered the moment the spec
// closes. A token inside a test title is labelled with that title; anywhere else, with "spec".
func collectWebSpecs(root string) ([]coverage, error) {
	dir := filepath.Join(root, "web", "tests")
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return nil, nil
	}
	var out []coverage
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || (!strings.HasSuffix(path, ".spec.ts") && !strings.HasSuffix(path, ".test.ts")) {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		out = append(out, parseWebSpec(rel, string(body))...)
		return nil
	})
	return out, err
}

func parseWebSpec(rel, body string) []coverage {
	var out []coverage
	index := map[string]int{} // label → position in out, so a label seen twice is one entry
	for _, line := range strings.Split(body, "\n") {
		tags := tagRe.FindAllString(line, -1)
		if len(tags) == 0 {
			continue
		}
		label := "spec"
		if m := testTitleRe.FindStringSubmatch(line); m != nil {
			label = strings.TrimSpace(m[1])
		}
		i, ok := index[label]
		if !ok {
			i = len(out)
			index[label] = i
			out = append(out, coverage{file: rel, scenario: label})
		}
		out[i].tags = dedupe(append(out[i].tags, tags...))
	}
	return out
}

func (r *report) print() {
	if len(r.orphans) > 0 {
		fmt.Fprintf(os.Stderr, "\ntags pointing at criteria that do not exist:\n")
		for _, t := range r.orphans {
			fmt.Fprintf(os.Stderr, "  %s\n", t)
		}
	}
	if len(r.blocking) > 0 {
		fmt.Fprintf(os.Stderr, "\nacceptance criteria of an active or closed spec with no scenario:\n")
		for _, id := range r.blocking {
			c := r.criteria[id]
			fmt.Fprintf(os.Stderr, "  %s (spec %s, %s) — %s\n", id, c.spec, c.status, truncate(c.text, 90))
		}
	}
	if drafts := len(r.uncovered) - len(r.blocking); drafts > 0 {
		fmt.Printf("%d criteria of draft specs are not covered yet (expected before their milestone)\n", drafts)
	}
}

func (r *report) write(path string) error {
	var b strings.Builder
	b.WriteString("# Матрица трассируемости\n\n")
	b.WriteString("> Файл генерируется командой `make trace` из `specs/*/spec.md`, `features/**/*.feature` и\n")
	b.WriteString("> `web/tests/**`. Правьте спеки, сценарии и тесты, а не этот файл.\n\n")
	fmt.Fprintf(&b, "Критериев приёмки: **%d**. Без покрытия: **%d**.\n\n", len(r.ordered), len(r.uncovered))
	b.WriteString("| Критерий | Спека | Требование | Сценарии |\n|---|---|---|---|\n")
	for _, id := range r.ordered {
		c := r.criteria[id]
		var cells []string
		for _, cov := range c.covered {
			cells = append(cells, fmt.Sprintf("`%s` — %s", cov.file, cov.scenario))
		}
		proof := strings.Join(cells, "<br>")
		if proof == "" {
			proof = "**нет покрытия**"
		}
		fmt.Fprintf(&b, "| %s | %s %s | %s | %s |\n", id, c.spec, c.status, truncate(c.text, 100), proof)
	}
	if len(r.uncovered) > 0 {
		b.WriteString("\n## Без покрытия\n\n")
		b.WriteString("Активная или закрытая спека без покрытия — провал сборки. Черновик — ожидаемо.\n\n")
		for _, id := range r.uncovered {
			c := r.criteria[id]
			fmt.Fprintf(&b, "- %s (спека %s, %s) — %s\n", id, c.spec, c.status, truncate(c.text, 100))
		}
	}
	if len(r.orphans) > 0 {
		b.WriteString("\n## Теги без критерия\n\n")
		for _, t := range r.orphans {
			fmt.Fprintf(&b, "- %s\n", t)
		}
	}
	return os.WriteFile(path, []byte(b.String()), 0o644)
}

// sortIDs orders criteria by spec and number as numbers: REQ-000-10 comes after REQ-000-9, which a
// string sort would get wrong the moment a spec has ten criteria.
func sortIDs(ids []string) {
	key := func(id string) (spec, num int) {
		fmt.Sscanf(id, "REQ-%d-%d", &spec, &num)
		return spec, num
	}
	sort.Slice(ids, func(i, j int) bool {
		si, ni := key(ids[i])
		sj, nj := key(ids[j])
		if si != sj {
			return si < sj
		}
		return ni < nj
	})
}

// dedupe removes repeated tags so that one scenario cannot appear twice under the same criterion.
func dedupe(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

// truncate shortens a string to n runes, not n bytes: the specs are in Russian, and slicing bytes would
// cut a multi-byte character in half and produce mojibake in the generated table.
func truncate(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n-1]) + "…"
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "trace-gen: %v\n", err)
	os.Exit(1)
}
