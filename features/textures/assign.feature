@e2e
Feature: Putting a texture on a material
  A texture is useful once it is on a model. The designer picks a mesh, then one of the studio's textures;
  a material shared by two meshes gets it on both, and undo takes it off again.

  Background:
    Given the studio is open in a browser with an empty asset list
    And the designer has saved the file "bark_diffuse.png" as the texture "bark"
    And the designer has imported the file "moss_boar.glb" as a creature

  @req-002-4
  Scenario: A texture asset goes onto the selected mesh's material
    Given the designer has selected the mesh "tusk_left"
    When the designer sets the base colour texture to "bark"
    Then the mesh "tusk_left" shows the texture "bark"
    And the mesh "tusk_right" shows the texture "bark"
    And the mesh "body" shows its own texture

  @req-002-4
  Scenario: "none" takes the texture off and undo puts it back
    Given the designer has selected the mesh "tusk_left"
    And the designer has set the base colour texture to "bark"
    When the designer sets the base colour texture to "none"
    Then the mesh "tusk_left" has no texture
    When the designer presses Ctrl+Z
    Then the mesh "tusk_left" shows the texture "bark"
    When the designer presses Ctrl+Z
    Then the mesh "tusk_left" has no texture
