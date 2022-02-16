import fetch from "node-fetch"
import onProcessExit from "when-exit"
import { readFile, writeFile } from "fs/promises"
import { writeFileSync } from "fs"
import prompts from "prompts"
import { assert } from "@sindresorhus/is"

type HTTPMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH"

interface LocalAccount {
  name: string
  id: string
  token: string
  aliases?: string[]
}

interface ActionChoice extends prompts.Choice {
  value: () => void
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
  console.clear()
  console.log(`Saving ${accountsFilePath}...`)
  writeFileSync(accountsFilePath, JSON.stringify(accountsDatabase))
  console.log("Exiting!")
}

async function promptForAction() {
  const actions: prompts.Choice[] = [
    { title: "View accounts", value: showAccountsList },
  ]

  const { action } = await prompts({
    name: "action",
    message: "Choose an action",
    type: "select",
    instructions: false,
    choices: actions,
  })

  await action()
}

async function showAccountsList() {
  const promptOptions: prompts.PromptObject<string> = {
    name: "accounts",
    message: "Accounts",
    type: "select",
    hint: "Select an account to view info, or hit esc to go back",
    choices: [],
  }
  accountsDatabase.forEach((account) => {
    assert.array(promptOptions.choices)
    const accountListItem = `${account.name}`
    promptOptions.choices.push({ title: accountListItem, value: account.id })
  })

  console.clear()
  await prompts(promptOptions)
}

console.log("Loading account database file...")

const accountsFilePath = "accounts.json"
const accountsDatabase = await loadAccountsFile()
onProcessExit(flushAccountsFile)

await promptForAction()
