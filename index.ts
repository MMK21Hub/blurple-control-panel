import fetch from "node-fetch"
import onProcessExit from "when-exit"
import { readFile, writeFile } from "fs/promises"
import { writeFileSync } from "fs"

type HTTPMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH"

interface LocalAccount {
  name: string
  id: string
  token: string
  aliases?: string[]
}

class DiscordClient {
  baseEndpoint = "https://discord.com/api/v9/"
  token: string

  async apiRequest<Res extends any, Body extends any = never>(
    path: string,
    method?: HTTPMethod,
    data?: Body
  ): Promise<Res> {
    const requestOptions: RequestInit = {}

    if (data) {
      requestOptions.headers["Content-Type"] = "application/json"
      requestOptions.body = JSON.stringify(data)
    }

    const responseData = (await fetch(
      this.baseEndpoint + path.replace(/^\//, "")
    ).then((res) => res.json().catch(() => res.text()))) as Res

    return responseData
  }

  constructor(token) {
    this.token = token
  }
}

async function loadAccountsFile() {
  const fileContents = await readFile(accountsFilePath, "utf-8").catch(
    async (err) => {
      if (err.code != "ENOENT") throw err

      console.log(
        `Could not find accounts file at ${accountsFilePath}. Creating a new file.`
      )
      await writeFile(accountsFilePath, JSON.stringify([]), "utf-8")
      return readFile(accountsFilePath, "utf-8")
    }
  )

  try {
    return JSON.parse(fileContents) as LocalAccount[]
  } catch {
    console.warn(`Contents of file ${accountsFilePath} is not valid JSON`)
    return []
  }
}

function flushAccountsFile() {
  console.log(`Saving ${accountsFilePath}...`)
  writeFileSync(accountsFilePath, JSON.stringify(accountsDatabase))
  console.log("Exiting!")
}

console.log("Loading account database file...")

const accountsFilePath = "accounts.json"
const accountsDatabase = await loadAccountsFile()
onProcessExit(flushAccountsFile)
