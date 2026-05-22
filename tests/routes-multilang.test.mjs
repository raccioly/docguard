import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanRoutesDeep } from '../cli/scanners/routes.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-routes-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

// scanRoutesDeep skips the OpenAPI shortcut when docTools.openapi.found is false.
const NO_SPEC = { openapi: { found: false } };

describe('routes — multi-language scanners', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('Spring Boot (Java): @GetMapping/@PostMapping with class-level base path', () => {
    dir = make({
      'src/main/java/UsersController.java': `
        @RequestMapping("/api/users")
        public class UsersController {
          @GetMapping("/{id}")  public User getOne() {}
          @PostMapping public User create() {}
          @PreAuthorize("ROLE_ADMIN")
          @DeleteMapping("/{id}") public void delete() {}
        }
      `,
    });
    const routes = scanRoutesDeep(dir, { framework: 'Spring Boot' }, NO_SPEC);
    const keys = routes.map(r => `${r.method} ${r.path}`).sort();
    assert.ok(keys.includes('GET /api/users/{id}'));
    assert.ok(keys.includes('POST /api/users'));
    assert.ok(keys.includes('DELETE /api/users/{id}'));
    assert.ok(routes.some(r => r.auth), '@PreAuthorize → auth detected');
  });

  it('Rails (Ruby): verb DSL + resources expansion', () => {
    dir = make({
      'config/routes.rb': `
        Rails.application.routes.draw do
          get '/health', to: 'health#index'
          post '/login', to: 'sessions#create'
          resources :articles
        end
      `,
    });
    const routes = scanRoutesDeep(dir, { framework: 'Rails' }, NO_SPEC);
    const keys = routes.map(r => `${r.method} ${r.path}`);
    assert.ok(keys.includes('GET /health'));
    assert.ok(keys.includes('POST /login'));
    // resources :articles → 7 standard routes
    assert.ok(keys.includes('GET /articles'));
    assert.ok(keys.includes('POST /articles'));
    assert.ok(keys.includes('GET /articles/:id'));
    assert.ok(keys.includes('PATCH /articles/:id'));
    assert.ok(keys.includes('DELETE /articles/:id'));
  });

  it('Go: Gin/Echo/Chi-style verb calls', () => {
    dir = make({
      'main.go': `
        package main
        func main() {
          r := gin.Default()
          r.GET("/ping", ping)
          r.POST("/users", createUser)
          api := r.Group("/api")
          api.DELETE("/users/:id", del)
        }
      `,
    });
    const routes = scanRoutesDeep(dir, { framework: 'Gin' }, NO_SPEC);
    const keys = routes.map(r => `${r.method} ${r.path}`);
    assert.ok(keys.includes('GET /ping'));
    assert.ok(keys.includes('POST /users'));
    assert.ok(keys.includes('DELETE /users/:id'));
  });

  it('Rust: Axum + Actix + Rocket', () => {
    dir = make({
      'src/main.rs': `
        let app = Router::new()
          .route("/health", get(health))
          .route("/items", post(create_item));
      `,
      'src/actix.rs': `
        App::new().route("/login", web::post().to(login))
      `,
      'src/rocket.rs': `
        #[get("/world")]
        fn world() -> &'static str { "hi" }
      `,
    });
    const routes = scanRoutesDeep(dir, { framework: 'Axum' }, NO_SPEC);
    const keys = routes.map(r => `${r.method} ${r.path}`).sort();
    assert.ok(keys.includes('GET /health'), 'Axum get');
    assert.ok(keys.includes('POST /items'), 'Axum post');
    assert.ok(keys.includes('POST /login'), 'Actix web::post');
    assert.ok(keys.includes('GET /world'), 'Rocket #[get]');
  });
});
