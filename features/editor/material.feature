@e2e
Feature: Picking a mesh and editing its material
  A model is several meshes with several materials. The designer points at the one they mean and
  changes its colour and surface; a material shared by two meshes changes on both, because that is
  what sharing means in the file the game will load.

  Background:
    Given the studio is open in a browser with an empty asset list
    And the designer has imported the file "moss_boar.glb" as a creature

  @req-001-5
  Scenario: Clicking a mesh selects it and shows its material
    When the designer clicks the mesh "tusk_left"
    Then the mesh "tusk_left" is highlighted
    And the material panel shows "bone" with the colour "#e8e2d0", metalness 0.1 and roughness 0.6

  @req-001-5
  Scenario: Editing the material changes the selected mesh only
    Given the designer has selected the mesh "body"
    When the designer sets the colour to "#ff0000", metalness to 0.5 and roughness to 0.2
    Then the mesh "body" has the colour "#ff0000", metalness 0.5 and roughness 0.2
    And the mesh "tusk_left" has the colour "#e8e2d0", metalness 0.1 and roughness 0.6

  @req-001-5
  Scenario: A shared material changes on every mesh that uses it
    Given the designer has selected the mesh "tusk_left"
    When the designer sets the colour to "#00ff00"
    Then the mesh "tusk_right" has the colour "#00ff00"

  @req-001-5
  Scenario: Clicking empty space clears the selection
    Given the designer has selected the mesh "body"
    When the designer clicks empty space in the viewport
    Then nothing is selected
    And the material panel is hidden
