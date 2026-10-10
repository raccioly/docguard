/**
 * Scratch TypeORM and Sequelize projects with a written ground truth, for
 * specs/056-typeorm-models (docguard.typeorm-models).
 *
 * Each FILES object is a small but realistic project; each TRUTH object
 * states, by hand, what a correct scan of it reports. Nothing here reads
 * repository state.
 * @req docguard.typeorm-models#SC-001
 */

// ── TypeORM ─────────────────────────────────────────────────────────────────
//
// Layouts: `typeorm init` (src/entity/User.ts) and NestJS
// (src/posts/post.entity.ts). An abstract base class supplies id and
// timestamps. Every relation kind appears from both sides, plus a one-sided
// string-target relation. A MikroORM entity (also `@Entity()`) must be skipped.

export const TYPEORM_FILES = {
  'package.json': JSON.stringify({
    name: 'blog-api',
    dependencies: { typeorm: '0.3.20', pg: '8.11.5', 'reflect-metadata': '0.2.2' },
    devDependencies: { typescript: '5.4.5' },
  }, null, 2),
  'src/data-source.ts': `import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from './entity/User';

export const AppDataSource = new DataSource({ type: 'postgres', entities: [User], synchronize: false });
`,
  'src/entity/Base.ts': `import { PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** Shared columns; not a table of its own. */
export abstract class BaseModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
`,
  'src/entity/User.ts': `import { Entity, Column, OneToMany, OneToOne, DeleteDateColumn } from 'typeorm';
import { BaseModel } from './Base';
import { Post } from '../posts/post.entity';
import { Profile } from './Profile';

export enum Role { Admin = 'admin', Member = 'member' }

@Entity('users')
export class User extends BaseModel {
  @Column({ unique: true })
  email: string;

  // A comment that mentions @Column() must not become a field.
  @Column({ type: 'varchar', length: 80, nullable: true, comment: 'Shown on posts' })
  displayName: string | null;

  @Column({ type: 'enum', enum: Role, default: Role.Member })
  role: Role;

  @Column('int', { default: 0 })
  loginCount: number;

  @DeleteDateColumn()
  deletedAt?: Date;

  @OneToMany(() => Post, (post) => post.author)
  posts: Post[];

  @OneToOne(() => Profile, profile => profile.user)
  profile: Profile;

  get label(): string {
    return this.displayName ?? this.email;
  }
}
`,
  'src/entity/Profile.ts': `import { Entity, Column, OneToOne, JoinColumn } from 'typeorm';
import { BaseModel } from './Base';
import { User } from './User';

@Entity()
export class Profile extends BaseModel {
  @Column('text')
  bio: string;

  @OneToOne(() => User, user => user.profile)
  @JoinColumn()
  user: User;
}
`,
  'src/posts/post.entity.ts': `import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, ManyToMany, JoinTable, VersionColumn,
} from 'typeorm';
import { User } from '../entity/User';
import { Tag } from '../entity/Tag';

@Entity({ name: 'posts' })
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ nullable: true })
  body?: string;

  @Column({ default: false })
  published: boolean;

  @ManyToOne(() => User, (user) => user.posts, { onDelete: 'CASCADE' })
  author: User;

  @ManyToMany(() => Tag, (tag) => tag.posts)
  @JoinTable()
  tags: Tag[];

  @VersionColumn()
  version: number;

  summary(length = 80): string {
    return (this.body ?? '').slice(0, length);
  }
}
`,
  'src/entity/Tag.ts': `import { Entity, PrimaryColumn, Column, ManyToMany } from 'typeorm';
import { Post } from '../posts/post.entity';

@Entity()
export class Tag {
  @PrimaryColumn()
  slug: string;

  @Column({ unique: true })
  label: string;

  @ManyToMany(() => Post, (post) => post.tags)
  posts: Post[];
}
`,
  'src/entity/AuditLog.ts': `import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';

@Entity()
export class AuditLog {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ default: () => 'CURRENT_TIMESTAMP', type: 'timestamp' })
  at: Date;

  @ManyToOne('User')
  actor: unknown;
}
`,
  // MikroORM uses the same decorator name; it is not TypeORM.
  'src/legacy/Invoice.ts': `import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class Invoice {
  @PrimaryKey()
  id!: number;

  @Property()
  total!: number;
}
`,
};

export const TYPEORM_TRUTH = {
  entities: {
    AuditLog: ['at', 'id'],
    Post: ['body', 'id', 'published', 'title', 'version'],
    Profile: ['bio', 'createdAt', 'id', 'updatedAt'],
    Tag: ['label', 'slug'],
    User: ['createdAt', 'deletedAt', 'displayName', 'email', 'id', 'loginCount', 'role', 'updatedAt'],
  },
  tables: { AuditLog: null, Post: 'posts', Profile: null, Tag: null, User: 'users' },
  // field → [type, required, primaryKey, unique, default]
  fields: {
    'User.id': ['uuid', true, true, false, '—'],
    'User.createdAt': ['datetime', true, false, false, 'now()'],
    'User.updatedAt': ['datetime', true, false, false, 'now()'],
    'User.email': ['string', true, false, true, '—'],
    'User.displayName': ['string', false, false, false, '—'],
    'User.role': ['enum', true, false, false, 'Role.Member'],
    'User.loginCount': ['integer', true, false, false, '0'],
    'User.deletedAt': ['datetime', false, false, false, '—'],
    'Post.id': ['integer', true, true, false, '—'],
    'Post.title': ['string', true, false, false, '—'],
    'Post.body': ['string', false, false, false, '—'],
    'Post.published': ['boolean', true, false, false, 'false'],
    'Post.version': ['integer', true, false, false, '—'],
    'Tag.slug': ['string', true, true, false, '—'],
    'Tag.label': ['string', true, false, true, '—'],
    'Profile.bio': ['string', true, false, false, '—'],
    'AuditLog.id': ['integer', true, true, false, '—'],
    'AuditLog.at': ['datetime', true, false, false, 'CURRENT_TIMESTAMP'],
  },
  descriptions: { 'User.displayName': 'Shown on posts' },
  // from->to:field type
  relationships: [
    'AuditLog->User:actor many-to-one',
    'Post->Tag:tags many-to-many',
    'Post->User:author many-to-one',
    'Profile->User:user one-to-one',
  ],
  lines: { User: 9, Post: 8, AuditLog: 4 },
};

// ── Sequelize ───────────────────────────────────────────────────────────────
//
// `sequelize.define` (CommonJS, models/) and `Model.init` (TypeScript,
// src/models/), with associations declared on both sides.

export const SEQUELIZE_FILES = {
  'package.json': JSON.stringify({
    name: 'teams-api',
    dependencies: { sequelize: '6.37.3', pg: '8.11.5', express: '4.19.2' },
  }, null, 2),
  'models/user.js': `const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: DataTypes.STRING,
    isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Can manage teams' },
  }, { tableName: 'users' });

  User.associate = (models) => {
    User.hasMany(models.Post, { foreignKey: 'authorId' });
    User.hasOne(models.Profile);
    User.belongsToMany(models.Team, { through: 'Memberships' });
  };
  return User;
};
`,
  'models/profile.js': `module.exports = (sequelize, DataTypes) => {
  const Profile = sequelize.define('Profile', { bio: DataTypes.TEXT });
  Profile.associate = (models) => { Profile.belongsTo(models.User); };
  return Profile;
};
`,
  'models/team.js': `const { Model, DataTypes } = require('sequelize');

class Team extends Model {
  static associate(models) {
    this.belongsToMany(models.User, { through: 'Memberships' });
  }
}

module.exports = (sequelize) => {
  Team.init({ name: { type: DataTypes.STRING(60), allowNull: false } }, { sequelize });
  return Team;
};
`,
  'src/models/post.ts': `import { Model, DataTypes, Sequelize } from 'sequelize';

export class Post extends Model {}

export function initPost(sequelize: Sequelize) {
  Post.init({
    title: { type: DataTypes.STRING(120), allowNull: false },
    body: DataTypes.TEXT,
    authorId: { type: DataTypes.INTEGER, allowNull: false },
    publishedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  }, { sequelize, modelName: 'Post', tableName: 'posts' });
}

export function associatePost(models: any) {
  Post.belongsTo(models.User, { as: 'author', foreignKey: 'authorId' });
}
`,
};

export const SEQUELIZE_TRUTH = {
  entities: {
    Post: ['authorId', 'body', 'publishedAt', 'title'],
    Profile: ['bio'],
    Team: ['name'],
    User: ['email', 'id', 'isAdmin', 'name'],
  },
  tables: { Post: 'posts', Profile: null, Team: null, User: 'users' },
  fields: {
    'User.id': ['integer', true, true, false, '—'],
    'User.email': ['string', true, false, true, '—'],
    'User.name': ['string', false, false, false, '—'],
    'User.isAdmin': ['boolean', false, false, false, 'false'],
    'Post.title': ['string', true, false, false, '—'],
    'Post.body': ['string', false, false, false, '—'],
    'Post.publishedAt': ['datetime', false, false, false, 'DataTypes.NOW'],
    'Team.name': ['string', true, false, false, '—'],
    'Profile.bio': ['string', false, false, false, '—'],
  },
  descriptions: { 'User.isAdmin': 'Can manage teams' },
  relationships: [
    'Post->User:author many-to-one',
    'Profile->User:user one-to-one',
    'Team->User:user many-to-many',
  ],
  lines: { User: 4, Team: 10, Post: 6 },
};
