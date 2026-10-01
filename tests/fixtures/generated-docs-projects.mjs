/**
 * Five small projects, one per supported stack, used by the generated-docs
 * consistency tests (specs/044-generated-docs-consistency). Each exercises the
 * shapes that broke: a root route, a catch-all method, a handler written
 * inline, env vars with and without defaults, a JWT library, entities, tests.
 * @req docguard.generated-docs-consistency#SC-001
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const GITIGNORE = 'node_modules/\n.env\n__pycache__/\n';

export const PROJECTS = {
  'express-js': {
    area: 'src',
    files: {
      '.gitignore': GITIGNORE,
      'package.json': JSON.stringify({
        name: 'express-js', version: '1.0.0', type: 'module',
        dependencies: { express: '4.19.2', jsonwebtoken: '9.0.2', mongoose: '8.0.0' },
        devDependencies: { jest: '29.0.0' },
      }, null, 2),
      'src/app.js': `import express from 'express';
import jwt from 'jsonwebtoken';
import usersRouter from './routes/users.js';
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;
app.get('/', (req, res) => res.send('ok'));
app.get('/health', async (req, res) => { res.json({ ok: true }); });
app.all('/api/legacy-webhook', (req, res) => res.sendStatus(204));
app.post('/api/login', async (req, res) => { res.json({ token: jwt.sign({ id: 1 }, SECRET) }); });
app.use('/api/users', usersRouter);
app.listen(PORT);
export default app;
`,
      'src/routes/users.js': `import { Router } from 'express';
const router = Router();
router.get('/', listUsers);
router.get('/:id', async (req, res) => res.json({}));
router.delete('/:id', (req, res) => res.sendStatus(204));
function listUsers(req, res) { res.json([]); }
export default router;
`,
      'src/models/user.js': `import mongoose from 'mongoose';
const UserSchema = new mongoose.Schema({ email: { type: String, required: true }, name: String });
export const User = mongoose.model('User', UserSchema);
`,
      '.env.example': 'PORT=3000\nJWT_SECRET=\nDATABASE_URL=mongodb://localhost/app\n',
      'tests/app.test.js': "import { test } from 'node:test';\ntest('health', () => {});\n",
    },
  },
  'next-ts': {
    area: 'src',
    files: {
      '.gitignore': GITIGNORE,
      'package.json': JSON.stringify({
        name: 'next-ts', version: '1.0.0',
        dependencies: { next: '14.2.0', react: '18.2.0', '@prisma/client': '5.0.0', jsonwebtoken: '9.0.2' },
        devDependencies: { typescript: '5.4.0', vitest: '1.0.0' },
      }, null, 2),
      'tsconfig.json': '{"compilerOptions":{"strict":true}}\n',
      'src/app/api/users/route.ts': `import { NextResponse } from 'next/server';
export async function GET() { return NextResponse.json([]); }
export async function POST(req: Request) { return NextResponse.json({}); }
`,
      'src/app/api/users/[id]/route.ts': `import { NextResponse } from 'next/server';
export async function GET() { return NextResponse.json({}); }
export async function DELETE() { return new Response(null, { status: 204 }); }
`,
      'src/app/api/health/route.ts': "export async function GET() { return Response.json({ ok: true, region: process.env.REGION ?? 'us-east-1' }); }\n",
      'src/lib/auth.ts': `import jwt from 'jsonwebtoken';
export function verify(token: string) { return jwt.verify(token, process.env.JWT_SECRET as string); }
export const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
`,
      'prisma/schema.prisma': `datasource db { provider = "postgresql" url = env("DATABASE_URL") }
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}
model Post {
  id     Int  @id
  title  String
  userId Int
  user   User @relation(fields: [userId], references: [id])
}
`,
      'src/lib/auth.test.ts': "import { test } from 'vitest';\ntest('x', () => {});\n",
    },
  },
  'fastapi-py': {
    area: 'app',
    files: {
      '.gitignore': GITIGNORE,
      'requirements.txt': 'fastapi==0.110.0\npydantic==2.6.0\npyjwt==2.8.0\n',
      'app/main.py': `import os
import jwt
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()
SECRET = os.environ["JWT_SECRET"]
DEBUG = os.getenv("DEBUG", "false")

class Item(BaseModel):
    name: str
    price: float

@app.get("/")
def root():
    return {"ok": True}

@app.get("/items/{item_id}")
def read_item(item_id: int):
    return {"id": item_id}

@app.post("/items")
def create_item(item: Item):
    return item
`,
      'tests/test_main.py': 'def test_root():\n    assert True\n',
    },
  },
  'django-py': {
    area: 'shop',
    files: {
      '.gitignore': GITIGNORE,
      'requirements.txt': 'django==5.0\n',
      'manage.py': `import os, sys
if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "proj.settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)
`,
      'proj/settings.py': `import os
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev")
DEBUG = os.environ.get("DEBUG", "0") == "1"
INSTALLED_APPS = ["shop"]
ROOT_URLCONF = "proj.urls"
`,
      'proj/urls.py': 'from django.urls import path, include\nurlpatterns = [path("shop/", include("shop.urls"))]\n',
      'shop/models.py': `from django.db import models

class Product(models.Model):
    name = models.CharField(max_length=100)
    price = models.DecimalField(max_digits=8, decimal_places=2)

class Order(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    quantity = models.IntegerField()
`,
      'shop/views.py': `from django.http import JsonResponse
def product_list(request):
    return JsonResponse([], safe=False)
def product_detail(request, pk):
    return JsonResponse({})
`,
      'shop/urls.py': `from django.urls import path
from . import views
urlpatterns = [path("products/", views.product_list), path("products/<int:pk>/", views.product_detail)]
`,
      'shop/tests.py': 'from django.test import TestCase\nclass T(TestCase):\n    def test_x(self):\n        pass\n',
    },
  },
  'go-svc': {
    area: 'internal',
    files: {
      '.gitignore': GITIGNORE,
      'go.mod': 'module example.com/gosvc\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.1\n',
      'main.go': `package main

import (
	"os"
	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()
	port := os.Getenv("PORT")
	r.GET("/", func(c *gin.Context) { c.String(200, "ok") })
	r.GET("/todos", listTodos)
	r.POST("/todos", createTodo)
	r.DELETE("/todos/:id", deleteTodo)
	r.Any("/metrics", metrics)
	r.Run(":" + port)
}

func listTodos(c *gin.Context)  {}
func createTodo(c *gin.Context) {}
func deleteTodo(c *gin.Context) {}
func metrics(c *gin.Context)    {}
`,
      'internal/store/todo.go': `package store

type Todo struct {
	ID    int    \`json:"id"\`
	Title string \`json:"title"\`
	Done  bool   \`json:"done"\`
}
`,
      'main_test.go': 'package main\nimport "testing"\nfunc TestX(t *testing.T) {}\n',
    },
  },
};

/** Write `files` into a new temp dir; with `git`, commit them. Returns the dir. */
export function materialize(files, { prefix = 'gdc-', git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  if (git) {
    const run = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    run('init', '-q');
    run('config', 'user.email', 't@t');
    run('config', 'user.name', 't');
    run('config', 'gc.auto', '0');
    run('add', '-A');
    run('commit', '-qm', 'fixture');
  }
  return dir;
}
