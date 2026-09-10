@e2e
Feature: The studio in the browser
  These scenarios need a browser and a running studiod. godog skips the @e2e tag; they are executed by
  Playwright specs of the same names in web/tests/e2e (AGENTS.md, section 10, item 6). Until that harness
  exists they document the M0 frontend behaviour and keep REQ-000-11..13 traceable, nothing more.

  Background:
    Given the studio is open in a browser with an empty asset list

  @req-000-11
  Scenario Outline: A new placeholder of every kind appears in the viewport at metre scale
    When the designer chooses the kind <kind> and presses "New placeholder"
    Then the viewport shows a <shape> standing on the ground grid
    And the status line says a new <kind> placeholder is ready

    Examples:
      | kind      | shape          |
      | character | capsule        |
      | creature  | capsule        |
      | item      | box            |
      | landscape | terrain patch  |
      | texture   | textured plane |

  @req-000-12
  Scenario: Save exports the placeholder and the asset comes back from the list
    When the designer makes a creature placeholder named "moss_boar" bound to wowd id "moss_boar" and saves it
    Then "moss_boar" appears in the sidebar as a creature bound to "moss_boar"
    When the designer presses "New placeholder" and then clicks "moss_boar" in the sidebar
    Then the viewport shows the saved model again
    And the name and wowd id fields show "moss_boar" and "moss_boar"

  @req-000-12
  Scenario: A texture is saved as a PNG
    When the designer makes a texture placeholder named "bark_diffuse" and saves it
    Then "bark_diffuse" is stored in png format

  @req-000-13
  Scenario: In production the app and the API come from one origin
    Given studiod serves the built frontend
    When the browser opens the studio's root
    Then the app loads from the same origin as the API
    And an unknown path still loads the app
