@e2e
Feature: Undo and redo
  An editor without undo teaches the designer to be afraid of it. Every edit is one step back; a gizmo
  drag is one step, not sixty; saving is not a reason to forget.

  Background:
    Given the studio is open in a browser with an empty asset list
    And the designer has imported the file "moss_boar.glb" as a creature

  @req-001-4
  Scenario: A move is undone and redone from the keyboard
    When the designer sets the position to 1, 0, 0 metres
    And the designer presses Ctrl+Z
    Then the model's position is 0, 0, 0
    When the designer presses Ctrl+Shift+Z
    Then the model's position is 1, 0, 0

  @req-001-4
  Scenario: A material edit is undone with the button
    Given the designer has selected the mesh "body"
    When the designer sets the colour to "#ff0000"
    And the designer clicks Undo
    Then the mesh "body" has the colour "#8b5a2b"

  @req-001-4
  Scenario: A new edit after undo forgets the redo
    When the designer sets the position to 1, 0, 0 metres
    And the designer presses Ctrl+Z
    And the designer sets the position to 0, 2, 0 metres
    Then redo is not available

  @req-001-4
  Scenario: Fifty steps can be undone
    When the designer moves the model 60 times by 0.1 metre along X
    And the designer presses Ctrl+Z 50 times
    Then the model's position X is close to 1.0
    And undo is not available

  @req-001-4
  Scenario: One gizmo drag is one step
    When the designer drags the gizmo's X handle to the right
    And the designer presses Ctrl+Z
    Then the model's position is 0, 0, 0

  @req-001-4
  Scenario: Saving does not forget the history
    When the designer sets the position to 1, 0, 0 metres
    And the designer saves the asset as "moss_boar"
    And the designer presses Ctrl+Z
    Then the model's position is 0, 0, 0
