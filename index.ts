import fetch from "node-fetch"
import { readFile, writeFile } from "fs/promises"
import { writeFileSync } from "fs"
import onProcessExit from "when-exit"

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
  console.log("Done!")
  // await writeFile(accountsFilePath, JSON.stringify(accountsDatabase))
  // console.log("done")
}

function handleProcessExit() {
  console.log("Exiting")
  process.once("uncaughtException", () => {
    flushAccountsFile()
    process.exit(0)
  })
  throw new Error()
}

console.log("Loading account database file...")

const accountsFilePath = "accounts.json"
const accountsDatabase = await loadAccountsFile()

accountsDatabase.push({ id: "ss", name: "", token: "" })
// onProcessExit(async () => {
//   await flushAccountsFile()
//   console.log("Exiting!")
// })
// // flushAccountsFile()

// const exitEvents = [
//   `exit`,
//   `SIGINT`,
//   `SIGUSR1`,
//   `SIGUSR2`,
//   `uncaughtException`,
//   `SIGTERM`,
// ]
// exitEvents.forEach((eventName) =>
//   process.once(eventName, () => handleProcessExit)
// )

onProcessExit(flushAccountsFile)
// handleProcessExit()
