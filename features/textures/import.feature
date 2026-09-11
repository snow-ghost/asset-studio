@e2e
Feature: Importing a texture
  A PNG from disk becomes a texture asset the game can load as is. The studio keeps its bytes exactly:
  a texture that came in and went out unchanged is the one thing a designer can trust completely.

  Background:
    Given the studio is open in a browser with an empty asset list

  @req-002-1
  Scenario: A PNG from disk becomes a texture asset, byte for byte
    When the designer imports the file "bark_diffuse.png" as a texture
    Then the viewport shows the texture on a plane
    And the camera is framed on the model
    And the name field reads "bark_diffuse"
    And the panel shows the texture size 64 × 64 px
    When the designer saves the asset as "bark_diffuse"
    Then the stored payload of "bark_diffuse" is exactly the file "bark_diffuse.png"
    And the asset "bark_diffuse" is a texture in png format

  @req-002-2
  Scenario Outline: A file that is not a usable texture is refused with the reason
    Given the viewport shows a texture placeholder
    When the designer imports the file "<file>" as a <kind>
    Then the import is refused because "<reason>"
    And the viewport still shows the placeholder

    Examples:
      | file             | kind     | reason              |
      | not-a-model.bin  | texture  | not a glTF or PNG   |
      | bark_diffuse.png | creature | imported as glTF    |
      | moss_boar.glb    | texture  | PNG                 |
