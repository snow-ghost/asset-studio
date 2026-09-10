Feature: Finding and opening saved assets
  The sidebar is the list; a click is opening by id; the viewport loads the payload. What comes back
  must be exactly what was saved, or the studio is lying about what the game will show.

  Background:
    Given an empty studio

  @req-000-2
  Scenario: The list shows every saved asset, newest first
    Given the designer has saved a creature named "moss_boar" as glb
    And the designer has saved an item named "rusty_blade" as glb
    And the designer has saved a texture named "bark_diffuse" as png
    When the designer asks for the asset list
    Then the list holds 3 assets
    And they are ordered "bark_diffuse", "rusty_blade", "moss_boar"

  @req-000-2
  Scenario: An empty studio lists nothing
    When the designer asks for the asset list
    Then the list holds 0 assets

  @req-000-3
  Scenario: A saved asset can be opened again by id
    Given the designer has saved a creature named "moss_boar" as glb
    When the designer opens "moss_boar"
    Then it is a creature in glb format named "moss_boar"

  @req-000-3
  Scenario Outline: The payload comes back byte for byte with the content type of its format
    Given the designer has saved a <kind> named "<name>" as <format>
    When the designer opens the payload of "<name>"
    Then the payload is exactly what was saved
    And it is served as "<content type>"

    Examples:
      | kind     | name         | format | content type      |
      | creature | moss_boar    | glb    | model/gltf-binary |
      | item     | rusty_blade  | gltf   | model/gltf+json   |
      | texture  | bark_diffuse | png    | image/png         |

  @req-000-5
  Scenario: Deleting removes the asset and its payload
    Given the designer has saved a creature named "moss_boar" as glb
    And the designer has saved an item named "rusty_blade" as glb
    When the designer deletes "moss_boar"
    Then the deletion is confirmed
    And the asset list holds exactly "rusty_blade"
    And opening "moss_boar" answers not found
    And the studio's data directory holds no files for "moss_boar"

  @req-000-5
  Scenario: Deleting what does not exist is not found
    When the designer deletes the asset "0123456789abcdef"
    Then the studio answers not found

  # An id is a file name. Anything that could leave the data directory, or collide with the ".json"
  # metadata suffix, is treated as naming nothing rather than as an error worth explaining.
  @req-000-10
  Scenario Outline: An id that names nothing, or is not a safe file name, is not found
    When the designer opens the asset "<id>"
    Then the studio answers not found

    Examples:
      | id               |
      | 0123456789abcdef |
      | ../etc/passwd    |
      | moss.boar        |
      | moss boar        |
