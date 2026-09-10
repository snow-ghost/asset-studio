Feature: Development mode serves a frontend on another origin
  In development the frontend runs under Vite on its own port and calls studiod across origins; in
  production both come from one origin and CORS is off. Health is how `make server` is known to be up.

  @req-000-9
  Scenario: The frontend on another origin may call the API
    Given a studio started in development mode
    When the frontend asks permission to call the API from "http://localhost:5190"
    Then the preflight is answered with no content
    And the answer allows any origin
    And it allows the methods "GET, POST, PUT, DELETE, OPTIONS" and the header "Content-Type"

  @req-000-9
  Scenario: Every answer carries the allowed origin in development mode
    Given a studio started in development mode
    When the designer asks for the asset list
    Then the answer allows any origin

  @req-000-9
  Scenario: With CORS disabled no origin is allowed
    Given a studio started with CORS disabled
    When the designer asks for the asset list
    Then the answer names no allowed origin

  @req-000-9
  Scenario: Health answers ok
    Given an empty studio
    When the studio is asked whether it is healthy
    Then it answers "ok"
