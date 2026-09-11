@e2e
Feature: Importing a model
  A real asset arrives from an outside editor as a glTF file. The studio takes it in, shows it at metre
  scale so the designer can see whether it is a boar or a mountain, and refuses what it cannot promise
  to hand to the game unchanged.

  Background:
    Given the studio is open in a browser with an empty asset list

  @req-001-1
  Scenario: A GLB from disk appears in the viewport, framed and measured
    When the designer imports the file "moss_boar.glb" as a creature
    Then the viewport shows a model with 3 meshes and 48 vertices
    And the camera is framed on the model
    And the name field reads "moss_boar"
    And the panel shows the size 1.0 × 1.0 × 1.5 metres

  @req-001-1
  Scenario: A self-contained glTF imports the same way
    When the designer imports the file "moss_boar.gltf" as a creature
    Then the viewport shows a model with 3 meshes and 48 vertices

  @req-001-1
  Scenario: A name the designer already typed is kept
    Given the designer has typed the name "boar_v2"
    When the designer imports the file "moss_boar.glb" as a creature
    Then the name field reads "boar_v2"

  @req-001-2
  Scenario Outline: A file the studio cannot use is refused with the reason
    Given the viewport shows a creature placeholder
    When the designer imports the file "<file>" as a <kind>
    Then the import is refused because "<reason>"
    And the viewport still shows the placeholder

    Examples:
      | file            | kind     | reason         |
      | not-a-model.bin | creature | not a glTF     |
      | external.gltf   | creature | external files |
      | draco.gltf      | creature | compression    |
      | moss_boar.glb   | texture  | PNG            |
