Feature: The payload limit
  A model is large but not unbounded. Over the limit the studio says so and names the number, instead of
  failing somewhere inside JSON decoding; and what was stored before stays stored.

  @req-001-8
  Scenario: A payload over the limit is refused and the limit is named
    Given a studio whose payload limit is 1 MiB
    And the designer has saved a creature named "moss_boar" as glb
    When the designer saves "moss_boar" again with a payload of 1 MiB plus one byte
    Then the save is refused as too large, naming the limit "1 MiB"
    And opening its payload returns the original payload

  @req-001-8
  Scenario: A payload exactly at the limit is accepted
    Given a studio whose payload limit is 1 MiB
    When the designer saves a creature named "moss_boar" as glb with a payload of exactly 1 MiB
    Then the asset is stored under a new id
