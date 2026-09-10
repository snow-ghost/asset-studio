// Package bdd runs the Gherkin corpus in ../../../features against the studio, in process.
//
// The scenarios are the acceptance contract of the specs in specs/ (AGENTS.md, invariants 1 and 2). Each
// one names a criterion with an @req-NNN-x tag; make trace checks that every criterion has one. The suite
// is meant to run in milliseconds with no network and no Docker, so that it is the inner loop of
// development rather than a gate at the end.
package bdd

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/cucumber/godog"
	"github.com/cucumber/godog/colors"
)

// Two tags are excluded by default:
//
//	@wip — scenarios for a future milestone. They are written before the code on purpose (the spec is the
//	       source of truth) but must not fail a build for code that does not exist yet.
//	@e2e — scenarios that need a browser and a running studiod. Playwright executes them against the same
//	       scenario titles (AGENTS.md, section 7); running them here would mean faking a browser.
const defaultTags = "~@wip && ~@e2e"

var opts = godog.Options{
	Format:    "pretty",
	Paths:     []string{"../../../features"},
	Tags:      defaultTags,
	Output:    colors.Colored(os.Stdout),
	Strict:    true, // an undefined or pending step fails the run; a silently skipped step proves nothing
	Randomize: -1,   // random order, seeded per run: a dependence between scenarios must not hide
}

func init() {
	godog.BindCommandLineFlags("godog.", &opts)
}

func TestFeatures(t *testing.T) {
	o := opts
	o.TestingT = t

	// godog reads paths from positional arguments, which `go test` does not forward, so a subset is chosen
	// through the environment: `make bdd F=features/assets T='@req-000-3'`.
	if paths := os.Getenv("STUDIO_BDD_PATHS"); paths != "" {
		o.Paths = strings.Split(paths, ",")
	}
	if tags := os.Getenv("STUDIO_BDD_TAGS"); tags != "" {
		o.Tags = tags
	}

	status := godog.TestSuite{
		Name:                "asset-studio",
		ScenarioInitializer: initializeScenario,
		Options:             &o,
	}.Run()
	if status != 0 {
		t.Fatalf("acceptance suite failed with status %d", status)
	}
}

func initializeScenario(sc *godog.ScenarioContext) {
	// One fresh studio per scenario, in its own directory. Sharing would make a failure depend on which
	// scenarios ran before it, which is the fastest way to make an acceptance suite untrustworthy.
	s := newState()
	sc.After(func(ctx context.Context, _ *godog.Scenario, _ error) (context.Context, error) {
		s.cleanup()
		return ctx, nil
	})
	registerStudioSteps(sc, s)
}
