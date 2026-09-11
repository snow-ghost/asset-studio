@e2e
Feature: Unsaved changes are not lost silently
  The studio holds hours of hand work (invariant 10). Anything that would throw away unsaved edits asks
  first, and "no" means nothing happens.

  Background:
    Given the studio is open in a browser with an empty asset list
    And the designer has saved a creature placeholder as "other"
    And the designer has imported the file "moss_boar.glb" as a creature

  @req-001-7
  Scenario: An import marks the asset as modified
    Then the status and the tab title mark the asset as modified

  @req-001-7
  Scenario: Saving clears the mark
    When the designer saves the asset as "moss_boar"
    Then the asset is no longer marked as modified
    When the designer sets the position to 1, 0, 0 metres
    Then the status and the tab title mark the asset as modified

  @req-001-7
  Scenario Outline: Leaving unsaved work asks first, and no means stay
    When the designer <action> and declines the confirmation
    Then the model is still in the viewport
    And the status and the tab title mark the asset as modified

    Examples:
      | action                            |
      | presses New placeholder           |
      | imports the file "moss_boar.gltf" |
      | opens "other" from the sidebar    |

  @req-001-7
  Scenario: Confirming discards the work
    When the designer presses New placeholder and confirms
    Then the viewport shows a creature placeholder
    And the asset is no longer marked as modified
