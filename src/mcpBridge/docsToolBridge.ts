import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// Each tool definition returned by the endpoint.
interface RemoteTool {
    name: string
    description: string
    // JSON Schema object describing the tool's parameters.
    parameters: Record<string, unknown>
}

// A JSON Schema property descriptor (subset we need to map to Zod).
interface JsonSchemaProperty {
    type?: string
    description?: string
    enum?: unknown[]
    items?: JsonSchemaProperty
}

const endpointUrl = process.env.ROKDOCK_TOOL_URL
const endpointToken = process.env.ROKDOCK_TOOL_TOKEN

if (!endpointUrl || !endpointToken) {
    process.stderr.write('docsToolBridge: missing ROKDOCK_TOOL_URL/ROKDOCK_TOOL_TOKEN\n')
    process.exit(1)
}

const authHeaders = {
    Authorization: `Bearer ${endpointToken}`,
    'Content-Type': 'application/json',
}

/**
 * Convert a JSON Schema property descriptor to a Zod type.
 *
 * The MCP SDK requires a Zod raw shape (a Record<string, ZodType>) for inputSchema.
 * The endpoint delivers parameters as a JSON Schema object, so we map the
 * common scalar types here. Unknown types fall back to z.unknown() so the
 * tool is still registered and the actual value passes through to the endpoint.
 */
function jsonSchemaPropertyToZod(property: JsonSchemaProperty): z.ZodTypeAny {
    const { type, description } = property
    let zodType: z.ZodTypeAny

    if (type === 'string') {
        zodType = z.string()
    } else if (type === 'number' || type === 'integer') {
        zodType = z.number()
    } else if (type === 'boolean') {
        zodType = z.boolean()
    } else if (type === 'array') {
        const itemType = property.items ? jsonSchemaPropertyToZod(property.items) : z.unknown()
        zodType = z.array(itemType)
    } else {
        zodType = z.unknown()
    }

    if (description) {
        zodType = zodType.describe(description)
    }
    return zodType
}

/**
 * Build a Zod raw shape from a JSON Schema parameters object.
 *
 * The shape is a flat Record<string, ZodType> over the schema's properties.
 * Properties listed in "required" are kept as-is (required by default in Zod).
 * Optional properties are wrapped in .optional().
 *
 * An empty shape is returned when the schema has no properties,
 * which the SDK accepts as a no-parameter tool.
 */
function buildZodShape(parameters: Record<string, unknown>): Record<string, z.ZodTypeAny> {
    const properties = parameters.properties as Record<string, JsonSchemaProperty> | undefined
    if (!properties || typeof properties !== 'object') {
        return {}
    }

    const requiredSet = new Set(
        Array.isArray(parameters.required) ? (parameters.required as string[]) : [],
    )

    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [key, propertySchema] of Object.entries(properties)) {
        const zodField = jsonSchemaPropertyToZod(propertySchema)
        shape[key] = requiredSet.has(key) ? zodField : zodField.optional()
    }
    return shape
}

async function main(): Promise<void> {
    // Fetch the live tool list so the bridge does not hard-code any tool names.
    const toolListResponse = await fetch(`${endpointUrl}/tools`, { headers: authHeaders })
    if (!toolListResponse.ok) {
        throw new Error(`tool list fetch failed: ${toolListResponse.status}`)
    }
    const { tools } = (await toolListResponse.json()) as { tools: RemoteTool[] }

    const server = new McpServer({ name: 'rokdock', version: '1.0.0' })

    for (const tool of tools) {
        // The SDK requires a Zod raw shape for inputSchema, not a plain JSON Schema.
        // We convert the endpoint's JSON Schema properties to a Zod shape so the SDK
        // can generate the tool's JSON Schema for the MCP client automatically.
        const zodShape = buildZodShape(tool.parameters)

        server.registerTool(
            tool.name,
            { description: tool.description, inputSchema: zodShape },
            async (args: Record<string, unknown>) => {
                const callResponse = await fetch(`${endpointUrl}/call`, {
                    method: 'POST',
                    headers: authHeaders,
                    body: JSON.stringify({ name: tool.name, args }),
                })
                if (!callResponse.ok) {
                    throw new Error(`tool call failed: ${callResponse.status}`)
                }
                const result = (await callResponse.json()) as { content: string; isError?: boolean }
                return { content: [{ type: 'text' as const, text: result.content }], isError: result.isError }
            },
        )
    }

    await server.connect(new StdioServerTransport())
}

main().catch(err => {
    process.stderr.write('docsToolBridge: ' + String(err) + '\n')
    process.exit(1)
})
