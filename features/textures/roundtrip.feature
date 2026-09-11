@e2e
Feature: A texture survives saving the model
  The model the game loads is one GLB; a texture put on it in the studio must be inside that file, with the
  same pixels. The PNG bytes inside may differ — the exporter re-encodes — the pixels may not.

  Background:
    Given the studio is open in a browser with an empty asset list
    And the designer has saved the file "bark_diffuse.png" as the texture "bark"
    And the designer has imported the file "moss_boar.glb" as a creature bound to wowd id "moss_boar"

  @req-002-5
  Scenario: The assigned texture comes back embedded with the same pixels
    Given the designer has selected the mesh "tusk_left"
    And the designer has set the base colour texture to "bark"
    When the designer saves the asset as "moss_boar"
    And the designer opens "moss_boar" again from the sidebar
    Then the mesh "tusk_left" shows the texture "bark"
    And the mesh "body" shows its own texture
    And the model carries 2 textures
    And the manifest maps "moss_boar" to the asset that was saved
