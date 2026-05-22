import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanSchemasDeep } from '../cli/scanners/schemas.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-schemas-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const NO_DOCTOOLS = { openapi: { found: false } };

describe('schemas — multi-language model scanners', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('Python SQLAlchemy: extracts entities + columns + relationships', () => {
    dir = make({
      'app/models.py': `
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship, Mapped

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), nullable=False)
    nickname = Column(String(64), nullable=True)
    orders: Mapped[list["Order"]] = relationship("Order")

class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True)
    total = Column(Integer, nullable=False)
`,
    });
    const r = scanSchemasDeep(dir, {}, NO_DOCTOOLS);
    const names = r.entities.map(e => e.name);
    assert.ok(names.includes('User'));
    assert.ok(names.includes('Order'));
    const user = r.entities.find(e => e.name === 'User');
    assert.equal(user.source, 'sqlalchemy');
    const email = user.fields.find(f => f.name === 'email');
    assert.equal(email.required, true);
    const nickname = user.fields.find(f => f.name === 'nickname');
    assert.equal(nickname.required, false);
    assert.ok(r.relationships.some(rel => rel.from === 'User' && rel.to === 'Order'));
  });

  it('Python Pydantic: extracts a model with typed fields', () => {
    dir = make({
      'app/schemas.py': `
from pydantic import BaseModel
from typing import Optional

class UserCreate(BaseModel):
    email: str
    age: int
    nickname: Optional[str] = None
`,
    });
    const r = scanSchemasDeep(dir, {}, NO_DOCTOOLS);
    const e = r.entities.find(x => x.name === 'UserCreate');
    assert.ok(e, 'Pydantic model picked up');
    assert.equal(e.source, 'pydantic');
    assert.ok(e.fields.find(f => f.name === 'email').required);
    assert.equal(e.fields.find(f => f.name === 'nickname').required, false);
  });

  it('Rust Diesel: table! block → entity + columns', () => {
    dir = make({
      'src/schema.rs': `
table! {
  users (id) {
    id -> Integer,
    email -> Varchar,
    nickname -> Nullable<Text>,
  }
}
`,
    });
    const r = scanSchemasDeep(dir, {}, NO_DOCTOOLS);
    const e = r.entities.find(x => x.name === 'users');
    assert.ok(e);
    assert.equal(e.source, 'diesel');
    assert.equal(e.fields.find(f => f.name === 'email').required, true);
    assert.equal(e.fields.find(f => f.name === 'nickname').required, false);
  });

  it('Go struct with tags → entity + tagged fields', () => {
    dir = make({
      'internal/user.go': `
package internal
type User struct {
  ID      uint   ` + '`json:"id" gorm:"primaryKey"`' + `
  Email   string ` + '`json:"email" gorm:"uniqueIndex"`' + `
  Avatar  string ` + '`json:"avatar,omitempty"`' + `
  unexported string
}
`,
    });
    const r = scanSchemasDeep(dir, {}, NO_DOCTOOLS);
    const e = r.entities.find(x => x.name === 'User');
    assert.ok(e);
    assert.equal(e.source, 'go-struct');
    const names = e.fields.map(f => f.name);
    assert.ok(names.includes('ID') && names.includes('Email') && names.includes('Avatar'));
    assert.ok(!names.includes('unexported'), 'untagged field skipped');
    assert.equal(e.fields.find(f => f.name === 'Avatar').required, false, 'omitempty → optional');
  });

  it('Java JPA @Entity: class + typed fields', () => {
    dir = make({
      'src/main/java/User.java': `
@Entity
public class User {
  @Id
  private Long id;
  private String email;
  private Integer age;
}
`,
    });
    const r = scanSchemasDeep(dir, {}, NO_DOCTOOLS);
    const e = r.entities.find(x => x.name === 'User');
    assert.ok(e);
    assert.equal(e.source, 'jpa');
    const names = e.fields.map(f => f.name);
    assert.ok(names.includes('id') && names.includes('email') && names.includes('age'));
  });

  it('Rails migration: create_table → entity with columns + id', () => {
    dir = make({
      'db/migrate/20260101_create_articles.rb': `
class CreateArticles < ActiveRecord::Migration[7.1]
  def change
    create_table :articles do |t|
      t.string :title, null: false
      t.text :body
      t.integer :views
    end
  end
end
`,
    });
    const r = scanSchemasDeep(dir, {}, NO_DOCTOOLS);
    const e = r.entities.find(x => x.name === 'articles');
    assert.ok(e);
    assert.equal(e.source, 'rails-migration');
    const names = e.fields.map(f => f.name);
    assert.ok(names.includes('id'));
    assert.ok(names.includes('title'));
    assert.ok(names.includes('body'));
    assert.equal(e.fields.find(f => f.name === 'title').required, true);
  });

  it('polyglot: scans Python AND Go models in the same repo', () => {
    dir = make({
      'api/models.py': 'class User(Base):\n    __tablename__ = "users"\n    id = Column(Integer, primary_key=True)\n',
      'svc/user.go': 'package svc\ntype Profile struct { Name string `json:"name"` }\n',
    });
    const r = scanSchemasDeep(dir, {}, NO_DOCTOOLS);
    const names = r.entities.map(e => e.name);
    assert.ok(names.includes('User'), 'Python model captured');
    assert.ok(names.includes('Profile'), 'Go struct captured');
  });
});
