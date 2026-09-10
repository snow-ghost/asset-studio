Feature: Saving an asset
  The studio keeps what a designer makes: a model or a texture, under a name and a kind, with the
  payload stored as the very file wowd's client will load. Saving is also where a bad asset is refused,
  because an asset no workflow can open is worse than an error message.

  Background:
    Given an empty studio

  @req-000-1
  Scenario Outline: An asset of every kind can be saved
    When the designer saves a <kind> named "<name>" as <format>
    Then the asset is stored under a new id
    And it is a <kind> in <format> format named "<name>"

    Examples:
      | kind      | name         | format |
      | character | hero_body    | glb    |
      | creature  | moss_boar    | glb    |
      | item      | rusty_blade  | glb    |
      | landscape | fern_hollow  | glb    |
      | texture   | bark_diffuse | png    |

  @req-000-1
  Scenario: A freshly saved asset was created and changed at the same moment
    When the designer saves a creature named "moss_boar" as glb
    Then the asset records the same creation and update time

  @req-000-4
  Scenario: Saving again under the same id replaces the payload and keeps the id
    Given the designer has saved a creature named "moss_boar" as glb
    When the designer saves "moss_boar" again with a new payload
    Then the asset keeps its id and creation time
    And its update time is later than its creation time
    And opening its payload returns the new payload

  @req-000-4
  Scenario: A metadata-only save keeps the payload
    Given the designer has saved a creature named "moss_boar" as glb
    When the designer renames "moss_boar" to "mossy_boar" without touching its payload
    Then the asset is named "mossy_boar"
    And opening its payload returns the original payload

  @req-000-6
  Scenario Outline: A save with a missing or unknown field is refused and writes nothing
    When the designer saves a <kind> named "<name>" as <format>
    Then the save is refused because "<reason>"
    And the studio still has no assets

    Examples:
      | kind     | name      | format | reason             |
      | creature |           | glb    | name is required   |
      | dragon   | moss_boar | glb    | unknown kind       |
      | creature | moss_boar |        | format is required |
      | creature | moss_boar | exe    | unknown format     |

  # The payload's file name is <id>.<format>. The id is checked, so a format that carries a path would be
  # the one way left to write outside the data directory.
  @req-000-6
  Scenario: A format that is a path cannot write outside the data directory
    When the designer saves a creature named "moss_boar" as glb/../../escaped
    Then the save is refused because "unknown format"
    And nothing was written outside the studio's data directory

  @req-000-6
  Scenario: An id chosen by the client must be a safe file name
    When the designer saves a creature named "moss_boar" as glb under the id "../escape"
    Then the save is refused because "bad id"
    And nothing was written outside the studio's data directory

  @req-000-7
  Scenario: The format cannot change without a new payload
    Given the designer has saved a creature named "moss_boar" as glb
    When the designer changes "moss_boar" to gltf without a new payload
    Then the save is refused because "cannot change format without a new payload"
    And opening the payload of "moss_boar" returns the original payload as "model/gltf-binary"

  @req-000-7
  Scenario: Changing the format with a new payload leaves no orphan file
    Given the designer has saved a creature named "moss_boar" as glb
    When the designer saves "moss_boar" again as gltf with a new payload
    Then the asset is in gltf format
    And opening its payload returns the new payload as "model/gltf+json"
    And the studio's data directory holds exactly one payload for it
