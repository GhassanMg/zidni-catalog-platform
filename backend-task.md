# Technical Assessment: Product Management API with MCP Integration

## 1\. Overview

Design and implement a product management system with a backend API and an MCP server that enables AI agents to interact with the system through explicitly permitted actions.

**Required runtime:** Node.js  
**Preferred framework:** NestJS

## 2\. Product Requirements

### 2.1 Product and Category Management

- Implement CRUD operations for products and categories.
- Both tables must include a description field. Additional attributes may be introduced where appropriate.
- Provide suitable validation and consistent handling of relationships when creating, updating, or deleting records.

### 2.2 Users, Roles, and Permissions

Implement authentication and role-based authorization with at least two roles:

- **Admin:** Can read and modify products and categories.
- **Normal user:** Can read products and categories but cannot modify them.

Choose an appropriate authentication and authorization approach and document the reasoning behind your choice.

### 2.3 MCP Server Integration

Provide an MCP server that exposes the system's functionality to AI agents through defined tools.

- The agent must be able to read all products and categories, including their relationships.
- The agent must be able to create, update, and delete categories and manage their product relationships.
- All write operations initiated through MCP must be authorized according to the agent's assigned permissions.
- Every write action must be logged, including the operation, timestamp, affected resource, and initiating identity where available.
- The MCP server must not bypass the application's validation, authorization, or business rules.

## 3\. Implementation Requirements

### 3.1 Database Design

- Provide an ERD illustrating the database structure and relationships.
- Include appropriate keys, constraints, and indexes.
- Explain the main design decisions and any additional attributes introduced.

### 3.2 API and Documentation

- Provide a documented REST API with a Swagger/OpenAPI interface.
- Use clear request and response structures, appropriate HTTP status codes, and consistent error handling.
- Include the MCP tools and their input schemas in the project documentation.

### 3.3 Technology Choices

Node.js is required, and NestJS is preferred. Other technologies and libraries may be selected freely for databases, caching, testing, containerization, and supporting services.

Document significant technical and design decisions, explaining why each approach was chosen and any relevant trade-offs.

## 4\. AI-Assisted Development

AI coding assistants and vibe-coding agents are permitted.

Include a Markdown report describing your development workflow, the context and tasks provided to AI agents, and how generated code was reviewed and validated. Explain the distinction between tasks delegated to AI as a programmer and engineering decisions retained by you.

## 5\. Non-Functional Requirements

- **Availability:** The service should start reliably and handle ordinary operational failures appropriately.
- **Security:** Enforce authentication, authorization, input validation, and least-privilege access across API and MCP operations.
- **Reliability:** Handle failures consistently and preserve data integrity during related operations.
- **Accuracy:** Return correct data, maintain product-category relationships, and ensure that operations and audit logs accurately reflect what occurred.

## 6\. Deliverables and Submission

Submit a Git repository containing:

- Complete source code for the backend API and MCP server.
- Database schema and ERD.
- Swagger/OpenAPI documentation.
- Authentication and authorization implementation.
- Setup instructions and dependency specifications.
- Docker or Podman configuration for straightforward local execution.
- A Markdown report documenting AI-assisted development and technical/design decisions.
- Ready-to-run testing commands covering core functionality, permissions, and MCP operations.

The repository should preserve development history through meaningful commits and branches.

## 7\. Evaluation Criteria

Submissions will be evaluated on:

- Database design and relationship integrity.
- API design, validation, and documentation.
- Authentication, authorization, and role enforcement.
- MCP tool design, permissions, and integration quality.
- Accuracy and completeness of audit logging.
- Security, availability, reliability, and error handling.
- Ease of setup, reproducibility, and testing.
- Technical reasoning, AI-assisted development practices, and Git history.

**Priority:** Implement the core requirements before optional enhancements. Additional improvements are welcome once the required functionality is complete.
