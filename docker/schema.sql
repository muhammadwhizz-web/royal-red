-- CreateTable
CREATE TABLE "AwonSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT 'New session',
    "mode" TEXT NOT NULL DEFAULT 'build',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AwonMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AwonMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AwonSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AwonArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'site',
    "entry" TEXT NOT NULL DEFAULT 'index.html',
    "files" TEXT NOT NULL,
    "score" INTEGER,
    "review" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AwonArtifact_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AwonSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AwonArtifactVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "artifactId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "files" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AwonArtifactVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "AwonArtifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AwonAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AwonAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "runId" TEXT,
    "subAgentId" TEXT,
    "parentRunId" TEXT,
    "agentRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AwonConstraint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "assertion" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'extracted',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AwonVerification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "artifactId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" REAL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AwonProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeyEnc" TEXT,
    "keyHint" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'critique',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AwonRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "tool" TEXT NOT NULL,
    "agentRole" TEXT,
    "planJson" TEXT,
    "planHash" TEXT,
    "actionsTotal" INTEGER NOT NULL DEFAULT 0,
    "actionsDone" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "abortReason" TEXT,
    "parentRunId" TEXT,
    "role" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "AwonConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "runId" TEXT,
    "tier" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decision" TEXT,
    "ruleText" TEXT,
    "scope" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AwonConsentRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT,
    "ruleText" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AwonUndoEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "op" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "trashPath" TEXT,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AwonCostEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operation" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "runId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AwonMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "scopeRef" TEXT NOT NULL DEFAULT '',
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "confidence" REAL NOT NULL DEFAULT 1,
    "tags" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AwonEventLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "runId" TEXT,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "ignorable" BOOLEAN NOT NULL DEFAULT false,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AwonMessage_sessionId_createdAt_idx" ON "AwonMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AwonArtifact_sessionId_createdAt_idx" ON "AwonArtifact"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AwonArtifactVersion_artifactId_createdAt_idx" ON "AwonArtifactVersion"("artifactId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AwonArtifactVersion_artifactId_version_key" ON "AwonArtifactVersion"("artifactId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AwonAccount_username_key" ON "AwonAccount"("username");

-- CreateIndex
CREATE INDEX "AwonAudit_createdAt_idx" ON "AwonAudit"("createdAt");

-- CreateIndex
CREATE INDEX "AwonAudit_runId_idx" ON "AwonAudit"("runId");

-- CreateIndex
CREATE INDEX "AwonAudit_subAgentId_idx" ON "AwonAudit"("subAgentId");

-- CreateIndex
CREATE INDEX "AwonConstraint_sessionId_createdAt_idx" ON "AwonConstraint"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AwonVerification_sessionId_createdAt_idx" ON "AwonVerification"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AwonVerification_artifactId_idx" ON "AwonVerification"("artifactId");

-- CreateIndex
CREATE INDEX "AwonRun_sessionId_startedAt_idx" ON "AwonRun"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "AwonRun_parentRunId_idx" ON "AwonRun"("parentRunId");

-- CreateIndex
CREATE INDEX "AwonConsent_sessionId_status_createdAt_idx" ON "AwonConsent"("sessionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AwonConsent_runId_idx" ON "AwonConsent"("runId");

-- CreateIndex
CREATE INDEX "AwonConsentRule_op_enabled_idx" ON "AwonConsentRule"("op", "enabled");

-- CreateIndex
CREATE INDEX "AwonUndoEntry_sessionId_createdAt_idx" ON "AwonUndoEntry"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AwonUndoEntry_runId_seq_key" ON "AwonUndoEntry"("runId", "seq");

-- CreateIndex
CREATE INDEX "AwonCostEntry_createdAt_idx" ON "AwonCostEntry"("createdAt");

-- CreateIndex
CREATE INDEX "AwonCostEntry_providerId_idx" ON "AwonCostEntry"("providerId");

-- CreateIndex
CREATE INDEX "AwonCostEntry_runId_idx" ON "AwonCostEntry"("runId");

-- CreateIndex
CREATE INDEX "AwonMemory_scope_updatedAt_idx" ON "AwonMemory"("scope", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AwonMemory_scope_scopeRef_key_key" ON "AwonMemory"("scope", "scopeRef", "key");

-- CreateIndex
CREATE INDEX "AwonEventLog_sessionId_createdAt_idx" ON "AwonEventLog"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AwonEventLog_type_idx" ON "AwonEventLog"("type");

-- CreateIndex
CREATE UNIQUE INDEX "AwonEventLog_sessionId_seq_key" ON "AwonEventLog"("sessionId", "seq");

