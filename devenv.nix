{ pkgs, ... }:

{
  # Runtime tools available inside `devenv shell`.
  packages = [ pkgs.bun ];

  # One Postgres instance backs both `bun dev` and `bun test:e2e`. Isolation
  # between the two is by database name, not port — the app's ephemeral seed
  # path resets the DB it's connected to on every server start, so dev
  # dashboards on `waymark_app` stay untouched while e2e wipes `waymark_app_e2e`.
  services.postgres = {
    enable = true;
    package = pkgs.postgresql_16;
    listen_addresses = "127.0.0.1";
    port = 5433;

    initialDatabases = [
      { name = "waymark_source"; }
      { name = "waymark_app"; }
      { name = "waymark_source_e2e"; }
      { name = "waymark_app_e2e"; }
    ];

    # Superuser so the app can TRUNCATE / CREATE INDEX during ephemeral boot.
    # Password is decorative: connections come from localhost under trust auth.
    initialScript = ''
      CREATE ROLE waymark WITH LOGIN PASSWORD 'waymark' SUPERUSER;
    '';
  };

  # `devenv up -d` runs process-compose in the background; test/globalSetup.ts
  # calls it automatically when Playwright can't reach the postgres port.
}
