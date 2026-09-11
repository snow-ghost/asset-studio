@e2e
Feature: Moving, turning and scaling the model
  Models arrive facing any way and at any size. The designer puts them right with a gizmo or with
  numbers; whichever they use, the other must agree, or the numbers lie.

  Background:
    Given the studio is open in a browser with an empty asset list
    And the designer has imported the file "moss_boar.glb" as a creature

  @req-001-3
  Scenario: Typing into the transform fields moves the model
    When the designer sets the position to 1, 0, -2 metres
    Then the model's position is 1, 0, -2
    When the designer sets the rotation to 0, 90, 0 degrees
    Then the model's rotation is 0, 90, 0
    When the designer sets the scale to 2, 2, 2
    Then the panel shows the size 2.0 × 2.0 × 3.0 metres

  @req-001-3
  Scenario: Dragging the gizmo updates the fields
    Given the gizmo is in translate mode
    When the designer drags the gizmo's X handle to the right
    Then the model's position X is greater than 0
    And the position fields show the model's position

  @req-001-3
  Scenario: The gizmo modes follow W, E and R
    When the designer presses "e"
    Then the gizmo is in rotate mode
    When the designer presses "r"
    Then the gizmo is in scale mode
    When the designer presses "w"
    Then the gizmo is in translate mode

  @req-001-3
  Scenario Outline: A field accepts only a usable number
    When the designer types "<value>" into the scale X field
    Then the field is refused and the scale stays 1, 1, 1

    Examples:
      | value |
      | 0     |
      | -2    |
      | abc   |
