use rmcp::{transport::stdio, ServiceExt};

mod bridge;
mod edit_contract;
mod server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // stdout belongs exclusively to MCP's JSON-RPC transport.
    let service = server::ClavierDeskMcpServer::new().serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
