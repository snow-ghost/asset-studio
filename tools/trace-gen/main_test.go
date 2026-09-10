package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// tree writes a repository-shaped set of files into a fresh temp directory and returns its root.
func tree(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, body := range files {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func spec(status string, rows ...string) string {
	var b strings.Builder
	b.WriteString("# Spec\n\n**Статус:** " + status + " · **Веха:** M0\n\n")
	b.WriteString("| ID | Критерий | Сценарии |\n|---|---|---|\n")
	for _, r := range rows {
		b.WriteString(r + "\n")
	}
	return b.String()
}

func TestBuild(t *testing.T) {
	cases := []struct {
		name          string
		files         map[string]string
		wantIDs       []string
		wantUncovered []string
		wantBlocking  []string
		wantOrphans   int
		wantHoles     bool
	}{
		{
			name: "a covered criterion of an active spec is no hole",
			files: map[string]string{
				"specs/000-a/spec.md":  spec("Active", "| **REQ-000-1** | saved | `f` |"),
				"features/a/b.feature": "Feature: A\n\n  @req-000-1\n  Scenario: Saving works\n    Given x\n",
			},
			wantIDs: []string{"REQ-000-1"},
		},
		{
			name: "an uncovered criterion of an active spec fails",
			files: map[string]string{
				"specs/000-a/spec.md": spec("Active", "| **REQ-000-1** | saved | |"),
			},
			wantIDs: []string{"REQ-000-1"}, wantUncovered: []string{"REQ-000-1"}, wantBlocking: []string{"REQ-000-1"}, wantHoles: true,
		},
		{
			name: "an uncovered criterion of a closed spec fails",
			files: map[string]string{
				"specs/000-a/spec.md": spec("Closed", "| **REQ-000-1** | saved | |"),
			},
			wantIDs: []string{"REQ-000-1"}, wantUncovered: []string{"REQ-000-1"}, wantBlocking: []string{"REQ-000-1"}, wantHoles: true,
		},
		{
			name: "an uncovered criterion of a draft is reported but does not fail",
			files: map[string]string{
				"specs/001-b/spec.md": spec("Draft", "| **REQ-001-1** | later | |"),
			},
			wantIDs: []string{"REQ-001-1"}, wantUncovered: []string{"REQ-001-1"},
		},
		{
			name: "a spec without a status line is a draft",
			files: map[string]string{
				"specs/001-b/spec.md": "# Spec\n\n| ID | Критерий |\n|---|---|\n| **REQ-001-1** | later |\n",
			},
			wantIDs: []string{"REQ-001-1"}, wantUncovered: []string{"REQ-001-1"},
		},
		{
			name: "a tag naming no criterion fails",
			files: map[string]string{
				"specs/000-a/spec.md":  spec("Active", "| **REQ-000-1** | saved | |"),
				"features/a/b.feature": "Feature: A\n\n  @req-000-1 @req-000-7\n  Scenario: Saving works\n",
			},
			wantIDs: []string{"REQ-000-1"}, wantOrphans: 1, wantHoles: true,
		},
		{
			name: "a feature-level tag covers every scenario, a scenario tag only its own",
			files: map[string]string{
				"specs/000-a/spec.md": spec("Active",
					"| **REQ-000-1** | one | |", "| **REQ-000-2** | two | |", "| **REQ-000-3** | three | |"),
				"features/a/all.feature":  "@req-000-1\nFeature: All\n\n  Scenario: First\n\n  Scenario Outline: Second\n    Examples:\n      | x |\n",
				"features/e2e/ui.feature": "@e2e\nFeature: UI\n\n  @req-000-2\n  Scenario: Tagged\n\n  Scenario: Untagged\n",
			},
			wantIDs: []string{"REQ-000-1", "REQ-000-2", "REQ-000-3"}, wantUncovered: []string{"REQ-000-3"}, wantBlocking: []string{"REQ-000-3"}, wantHoles: true,
		},
		{
			name: "a browser spec covers a criterion",
			files: map[string]string{
				"specs/000-a/spec.md":              spec("Active", "| **REQ-000-1** | one | |", "| **REQ-000-2** | two | |"),
				"web/tests/e2e/studio.spec.ts":     "// Mirrors features/e2e/x.feature — @req-000-2\ntest('@req-000-1 a placeholder appears', async () => {});\n",
				"web/tests/unit/ignored.helper.ts": "// @req-000-9 not a spec file, must be ignored\n",
			},
			wantIDs: []string{"REQ-000-1", "REQ-000-2"},
		},
		{
			name: "a prose mention and a foreign spec number define nothing",
			files: map[string]string{
				"specs/000-a/spec.md": spec("Active", "| **REQ-000-1** | one | |") +
					"\nСм. REQ-000-9 и REQ-000-10 в находках. | REQ-000-11 | в ячейке без звёздочек |\n" +
					"| **REQ-001-1** | belongs to spec 001, cross reference here | |\n",
				"features/a/b.feature": "Feature: A\n\n  @req-000-1\n  Scenario: Saving works\n",
			},
			wantIDs: []string{"REQ-000-1"},
		},
		{
			name: "criteria are ordered as numbers",
			files: map[string]string{
				"specs/000-a/spec.md": spec("Draft",
					"| **REQ-000-10** | ten | |", "| **REQ-000-2** | two | |", "| **REQ-000-1** | one | |"),
				"specs/001-b/spec.md": spec("Draft", "| **REQ-001-1** | later | |"),
			},
			wantIDs:       []string{"REQ-000-1", "REQ-000-2", "REQ-000-10", "REQ-001-1"},
			wantUncovered: []string{"REQ-000-1", "REQ-000-2", "REQ-000-10", "REQ-001-1"},
		},
		{
			name: "no features and no web tests is fine for a draft",
			files: map[string]string{
				"specs/000-a/spec.md": spec("Draft", "| **REQ-000-1** | one | |"),
			},
			wantIDs: []string{"REQ-000-1"}, wantUncovered: []string{"REQ-000-1"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, err := build(tree(t, tc.files))
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(r.ordered, ","); got != strings.Join(tc.wantIDs, ",") {
				t.Errorf("ids = %s, want %s", got, strings.Join(tc.wantIDs, ","))
			}
			if got := strings.Join(r.uncovered, ","); got != strings.Join(tc.wantUncovered, ",") {
				t.Errorf("uncovered = %s, want %s", got, strings.Join(tc.wantUncovered, ","))
			}
			if got := strings.Join(r.blocking, ","); got != strings.Join(tc.wantBlocking, ",") {
				t.Errorf("blocking = %s, want %s", got, strings.Join(tc.wantBlocking, ","))
			}
			if len(r.orphans) != tc.wantOrphans {
				t.Errorf("orphans = %v, want %d", r.orphans, tc.wantOrphans)
			}
			if r.holes() != tc.wantHoles {
				t.Errorf("holes = %v, want %v", r.holes(), tc.wantHoles)
			}
		})
	}
}

func TestCoverageLabels(t *testing.T) {
	root := tree(t, map[string]string{
		"specs/000-a/spec.md": spec("Active",
			"| **REQ-000-1** | one | |", "| **REQ-000-2** | two | |", "| **REQ-000-3** | three | |"),
		"features/assets/saving.feature": "Feature: Saving\n\n  @req-000-1\n  Scenario Outline: An asset of every kind can be saved\n    Examples:\n      | k |\n",
		"web/tests/e2e/studio.spec.ts": "// @req-000-2 in a header comment\n" +
			"test('@req-000-3 the viewport shows a capsule', async () => {});\n" +
			"test.skip(\"@req-000-3 the same criterion, another test\", async () => {});\n",
	})
	r, err := build(root)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"REQ-000-1": "features/assets/saving.feature — An asset of every kind can be saved",
		"REQ-000-2": "web/tests/e2e/studio.spec.ts — spec",
		"REQ-000-3": "web/tests/e2e/studio.spec.ts — @req-000-3 the viewport shows a capsule|web/tests/e2e/studio.spec.ts — @req-000-3 the same criterion, another test",
	}
	for id, w := range want {
		var got []string
		for _, c := range r.criteria[id].covered {
			got = append(got, c.file+" — "+c.scenario)
		}
		if strings.Join(got, "|") != w {
			t.Errorf("%s covered by %q, want %q", id, strings.Join(got, "|"), w)
		}
	}
}

func TestWriteMatrix(t *testing.T) {
	root := tree(t, map[string]string{
		"specs/000-a/spec.md": spec("Active",
			"| **REQ-000-1** | Ассет каждого вида сохраняется | |",
			"| **REQ-000-2** | "+strings.Repeat("я", 150)+" | |"),
		"features/a/b.feature": "Feature: A\n\n  @req-000-1 @req-000-9\n  Scenario: Saving works\n",
	})
	r, err := build(root)
	if err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(root, "docs", "traceability.md")
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := r.write(out); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	for _, want := range []string{
		"# Матрица трассируемости",
		"`make trace`",
		"Критериев приёмки: **2**. Без покрытия: **1**.",
		"| Критерий | Спека | Требование | Сценарии |",
		"| REQ-000-1 | 000 Active | Ассет каждого вида сохраняется | `features/a/b.feature` — Saving works |",
		"| REQ-000-2 | 000 Active | " + strings.Repeat("я", 99) + "… | **нет покрытия** |",
		"## Без покрытия",
		"## Теги без критерия",
		"@req-000-9 in features/a/b.feature (Saving works)",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("matrix lacks %q\n%s", want, text)
		}
	}
	if strings.Contains(text, "�") {
		t.Error("matrix contains a broken multi-byte character: truncation cut a rune")
	}
}

func TestParseStatus(t *testing.T) {
	for in, want := range map[string]specStatus{
		"**Статус:** Active · **Веха:** M0": statusActive,
		"**Статус:** Closed":                statusClosed,
		"**Статус:** Закрыта":               statusClosed,
		"**Status:** Активна":               statusActive,
		"**Статус:** Draft":                 statusDraft,
		"no status line at all":             statusDraft,
	} {
		if got := parseStatus(in); got != want {
			t.Errorf("parseStatus(%q) = %s, want %s", in, got, want)
		}
	}
}
