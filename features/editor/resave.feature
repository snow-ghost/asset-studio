@e2e
Feature: Re-saving an edited model
  What the designer sees after Save must be what the game loads: the same meshes, the same numbers, the
  same materials, the textures and animations the file came with. Anything lost here is lost silently
  for every player.

  Background:
    Given the studio is open in a browser with an empty asset list

  @req-001-6
  Scenario: What was saved is what comes back
    Given the designer has imported the file "moss_boar.glb" as a creature bound to wowd id "moss_boar"
    And the designer has set the position to 1, 0.5, -2 metres, the rotation to 0, 90, 0 degrees and the scale to 2, 2, 2
    And the designer has selected the mesh "body" and set the colour to "#336699", metalness to 0.3 and roughness to 0.4
    When the designer saves the asset as "moss_boar"
    And the designer opens "moss_boar" again from the sidebar
    Then the model has 3 meshes, 48 vertices and 60 indices
    And the model's position is 1, 0.5, -2, its rotation 0, 90, 0 and its scale 2, 2, 2
    And the mesh "body" has the colour "#336699", metalness 0.3 and roughness 0.4
    And the mesh "tusk_left" has the colour "#e8e2d0", metalness 0.1 and roughness 0.6
    And the model carries 1 texture and 1 animation
    And the manifest maps "moss_boar" to the asset that was saved

  @req-001-6
  Scenario: Saving again keeps the id
    Given the designer has imported the file "moss_boar.glb" as a creature
    And the designer has saved the asset as "moss_boar"
    When the designer sets the position to 0, 1, 0 metres
    And the designer saves the asset as "moss_boar"
    Then the sidebar holds exactly one "moss_boar"
    And its id is the one from the first save
