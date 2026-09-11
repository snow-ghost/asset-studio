@e2e
Feature: Procedural textures
  When there is nothing to draw yet, a texture is made from a handful of numbers. The same numbers must
  give the same pixels, and the numbers must survive saving — otherwise the texture is a picture, not a
  recipe.

  Background:
    Given the studio is open in a browser with an empty asset list
    And the designer starts a new texture placeholder

  @req-002-3
  Scenario: A new texture is procedural and editable
    Then the texture panel shows the type "checker" and the size 256
    When the designer sets the texture type to "stripes" and the size to 512
    Then the viewport texture is 512 × 512 pixels
    And the status and the tab title mark the asset as modified

  @req-002-3
  Scenario: The same parameters give the same pixels, another seed different ones
    When the designer sets the texture type to "noise" and the seed to 7
    And the designer remembers the texture pixels
    And the designer sets the seed to 8
    Then the texture pixels differ from the remembered ones
    When the designer sets the seed to 7
    Then the texture pixels equal the remembered ones

  @req-002-3
  Scenario: Parameters survive saving and the texture is editable again
    When the designer sets the texture type to "noise", the seed to 42 and the scale to 3
    And the designer saves the asset as "moss_noise"
    And the designer presses New placeholder and opens "moss_noise" from the sidebar
    Then the texture panel shows the type "noise", the seed 42 and the scale 3
    And the stored payload of "moss_noise" is a PNG of 256 × 256 pixels
