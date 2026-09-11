Feature: A payload is what its format and kind say it is
  The studio stores exactly the file the game will load (invariant 5). A texture that is really a model,
  or a "png" whose bytes are not a PNG, would be stored faithfully and fail only in the game — so the
  server refuses them here, where the designer can still hear why.

  Background:
    Given an empty studio

  @req-002-6
  Scenario Outline: A format that does not fit the kind is refused
    When the designer saves a <kind> named "thing" as <format>
    Then the save is refused because "not valid for kind"
    And the studio still has no assets

    Examples:
      | kind     | format |
      | texture  | glb    |
      | texture  | gltf   |
      | creature | png    |
      | item     | png    |

  @req-002-6
  Scenario Outline: A payload whose bytes are not what its format says is refused
    When the designer saves a <kind> named "thing" as <format> with a payload that is not <format>
    Then the save is refused because "does not look like"
    And the studio still has no assets

    Examples:
      | kind     | format |
      | texture  | png    |
      | creature | glb    |
      | creature | gltf   |

  @req-002-6
  Scenario: Procedural parameters are kept for a texture
    When the designer saves a texture named "bark" as png with procedural parameters
    Then opening "bark" returns the same procedural parameters
    And the manifest entry for "bark" carries no procedural parameters

  @req-002-6
  Scenario Outline: Procedural parameters are refused where they make no sense
    When the designer saves a <kind> named "thing" as <format> with <what> procedural parameters
    Then the save is refused because "procedural"
    And the studio still has no assets

    Examples:
      | kind     | format | what         |
      | creature | glb    | some         |
      | texture  | png    | non-object   |
      | texture  | png    | oversized    |
