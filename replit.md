# Overview

This is a cryptocurrency trading bot application that integrates with the Gemini exchange and Discord for automated trading and real-time notifications. The system provides a web-based dashboard for managing trading settings, monitoring portfolio performance, and controlling bot operations. It features automated trading strategies with risk management controls, real-time portfolio tracking, and Discord bot integration for remote monitoring and notifications.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens and dark mode support
- **State Management**: TanStack Query for server state management and caching
- **Routing**: Wouter for lightweight client-side routing
- **Real-time Updates**: WebSocket integration for live portfolio and trading updates

## Backend Architecture
- **Runtime**: Node.js with Express.js REST API
- **Language**: TypeScript with ES modules
- **Database ORM**: Drizzle ORM with PostgreSQL dialect
- **Real-time Communication**: WebSocket server for bidirectional client-server communication
- **Service Architecture**: Modular service classes for external integrations (Gemini API, Discord Bot, Trading Engine)

## Database Design
- **Primary Database**: PostgreSQL with Neon serverless hosting
- **Schema Management**: Drizzle migrations with type-safe schema definitions
- **Key Entities**: Users, trading settings, portfolio holdings, trade orders, and trading history
- **Data Relationships**: Foreign key constraints with cascade deletes for user data isolation

## Authentication & Security
- **Session Management**: PostgreSQL-backed session storage using connect-pg-simple
- **API Security**: Environment-based API key management for external services
- **Input Validation**: Zod schema validation for all API endpoints and forms

## External Service Integrations

### Gemini Exchange API
- **Purpose**: Cryptocurrency trading execution and market data
- **Implementation**: Custom service class with HMAC signature authentication
- **Features**: Real-time ticker data, account balances, order placement and management
- **Error Handling**: Comprehensive error handling for API rate limits and connection issues

### Discord Bot Integration
- **Purpose**: Real-time trading notifications and remote portfolio monitoring
- **Implementation**: Discord.js library with slash commands and embed messaging
- **Features**: Portfolio updates, trade alerts, interactive buttons for bot control
- **Permissions**: Configurable guild and channel-specific deployments

### Google Generative AI
- **Purpose**: Advanced trading analytics and market insights
- **Implementation**: Google Generative AI SDK integration
- **Use Cases**: Market analysis, trading recommendations, risk assessment

## Trading Engine
- **Architecture**: Event-driven trading engine with configurable strategies
- **Risk Management**: Stop-loss and take-profit automation with percentage-based triggers
- **Position Management**: Automated portfolio rebalancing and position sizing
- **Monitoring**: Continuous price monitoring with configurable update frequencies
- **Strategy Support**: Multiple profit-taking strategies including fixed percentage and dynamic adjustments

## Real-time Features
- **WebSocket Communication**: Bidirectional real-time updates for portfolio changes and trade execution
- **Live Price Feeds**: Continuous market data integration with 30-second default refresh intervals
- **Instant Notifications**: Real-time Discord notifications for trade execution and portfolio milestones
- **Status Broadcasting**: Live connection status and trading engine state updates

## Development & Deployment
- **Build System**: Vite for frontend bundling with esbuild for server compilation
- **Development Environment**: Hot module replacement with Vite development server
- **Environment Configuration**: Separate development and production configurations
- **Error Handling**: Comprehensive error boundaries and logging throughout the application