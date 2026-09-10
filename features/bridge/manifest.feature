Feature: The manifest is the bridge to wowd
  The game owns the ids (creature_id, item id, zone id); the studio owns the pictures. The manifest maps
  one to the other and is the only thing wowd's client will ever ask the studio for
  (docs/integration-with-wowd.md). Everything in it must be loadable, and nothing unbound belongs in it.

  Background:
    Given an empty studio

  @req-000-8
  Scenario: Only assets bound to a wowd id are in the manifest, and each entry is loadable
    Given the designer has saved a creature named "Mossy Boar" as glb bound to wowd id "moss_boar"
    And the designer has saved an item named "Rusty Blade" as glb bound to wowd id "rusty_blade"
    And the designer has saved a creature named "unbound sketch" as glb
    When the game asks for the manifest
    Then the manifest is version 1
    And it maps exactly the wowd ids "moss_boar", "rusty_blade"
    And the entry for "moss_boar" is a creature in glb format named "Mossy Boar"
    And the entry for "moss_boar" points at the payload of "Mossy Boar"
    And the game can fetch that payload

  # An empty list, not null: the client will call .find() on it.
  @req-000-8
  Scenario: A studio with nothing bound hands the game an empty list
    Given the designer has saved a creature named "unbound sketch" as glb
    When the game asks for the manifest
    Then the manifest is version 1
    And it maps no wowd ids

  @req-000-8
  Scenario: Unbinding an asset takes it out of the manifest
    Given the designer has saved a creature named "Mossy Boar" as glb bound to wowd id "moss_boar"
    When the designer unbinds "Mossy Boar" from wowd
    And the game asks for the manifest
    Then it maps no wowd ids
