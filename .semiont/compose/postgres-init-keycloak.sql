-- Keycloak keeps its realm in its own database on this PostgreSQL, as the
-- launcher does. initdb runs this once, when the data volume is first created.
CREATE DATABASE keycloak;
