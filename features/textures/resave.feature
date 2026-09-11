@e2e
Feature: Re-saving a texture keeps its bytes
  Opening a texture and pressing Save must not rewrite it: a re-encoded PNG is a different file for no
  reason. Only a changed recipe changes the pixels.

  Background:
    Given the studio is open in a browser with an empty asset list

  @req-002-7
  Scenario: Saving an opened texture without changes leaves the payload untouched
    Given the designer has saved the file "bark_diffuse.png" as the texture "bark"
    When the designer presses New placeholder and opens "bark" from the sidebar
    And the designer saves the asset as "bark"
    Then the stored payload of "bark" is exactly the file "bark_diffuse.png"

  @req-002-7
  Scenario: Changing the recipe of a procedural texture changes the payload
    Given the designer has saved a new procedural texture as "noise1"
    And the designer remembers the stored payload of "noise1"
    When the designer presses New placeholder and opens "noise1" from the sidebar
    And the designer sets the seed to 99
    And the designer saves the asset as "noise1"
    Then the stored payload of "noise1" differs from the remembered one
