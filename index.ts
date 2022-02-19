import fetch, { Headers } from "node-fetch"
import onProcessExit from "when-exit"
import { readFile, writeFile } from "fs/promises"
import { writeFileSync } from "fs"
import prompts from "prompts"
import is, { assert } from "@sindresorhus/is"
import chalk from "chalk"
import promptsHelpers from "prompts-helpers"

console.clear = emptyCallback

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
  token

  async apiRequest<Res extends any, Body extends any = never>(
    path: string,
    method?: HTTPMethod,
    data?: Body
  ): Promise<Res> {
    const requestOptions: RequestInit = {}
    requestOptions.headers = new Headers()

    if (data) {
      requestOptions.headers.append("Content-Type", "application/json")
      requestOptions.body = JSON.stringify(data)
    }

    const responseData = (await fetch(
      this.baseEndpoint + path.replace(/^\//, "")
    ).then((res) => res.json().catch(() => res.text()))) as Res

    return responseData
  }

  constructor(token: string) {
    this.token = token
  }
}

function emptyCallback(...args: unknown[]) {
  return
}

function sanitizeToken(token: string) {
  return token
    .split(".")
    .map((value, i) => (i > 1 ? value.replace(/./g, "*") : value))
    .join(".")
}

function promptWithEscape(
  question: prompts.PromptObject<string>
): Promise<prompts.Answers<string>> {
  return new Promise((resolve, reject) => {
    const promptPromise = prompts(question)
    promptPromise.then((res) => {
      res[question.name.toString()] === undefined ? reject(0) : resolve(res)
    })
  })
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

function getAccountFromDatabase(id: string) {
  const matchingAccounts = accountsDatabase.filter(
    (account) => account.id === id
  )
  if (matchingAccounts.length > 1)
    throw new Error(
      "Found multiple accounts with the same ID in the database: " + id
    )
  return matchingAccounts ? matchingAccounts[0] : null
}

function initialActionPrompt() {
  return actionPrompt(
    { "View accounts": showAccountsList },
    { clear: true, title: "Blurple Control Panel" }
  )
}

function showAccountsList(): Promise<void | prompts.Answers<string>> {
  const promptOptions: prompts.PromptObject<string> = {
    name: "account",
    message: "Accounts",
    type: "select",
    hint: "Select an account to view info, or hit esc to go back",
    limit: 20,
    choices: [],
  }
  accountsDatabase.forEach((account) => {
    assert.array(promptOptions.choices)
    let accountListItem =
      `${account.name}` +
      (account.aliases ? ` (${account.aliases.join(", ")})` : "")
    promptOptions.choices.push({ title: accountListItem, value: account.id })
  })

  console.clear()
  return promptWithEscape(promptOptions).then(({ account: id }) => {
    showAccountInfo(id).catch(showAccountsList)
  })
}

async function showAccountInfo(id: string) {
  const account = getAccountFromDatabase(id)
  if (!account)
    throw new Error("Cannot show information for a non-existent account")

  console.clear()
  console.log(chalk.bold(account.name))
  account.aliases?.forEach((alias) => {
    console.log(chalk.dim(`AKA ${alias}`))
  })
  console.log()
  console.log(chalk.cyan("User ID: ") + account.id)
  console.log(chalk.cyan("Token:   ") + sanitizeToken(account.token))
  console.log()

  actionPrompt({ Nope: () => {} })
}

async function actionPrompt(
  actions: Record<string, () => void>,
  options: {
    title?: string
    hint?: string
    clear?: boolean
  } = {}
) {
  options.title ??= "Actions"
  options.clear ??= false
  options.hint ??= "Choose an action, or hit Esc to go back"

  const choices: prompts.Choice[] = []
  for (const actionName in actions) {
    choices.push({
      title: actionName,
      value: actions[actionName],
    })
  }

  if (options.clear) console.clear()
  return await prompts({
    name: "action",
    message: options.title,
    type: "select",
    instructions: false,
    hint: options.hint,
    choices,
  })
    .then((res) => {
      const returnedValue = res.action?.()
      if (is.promise(returnedValue)) {
        // Take the user back to this actionPrompt if they hit esc
        returnedValue.catch(() => actionPrompt(actions, options))
      }
      return returnedValue
    })
    .catch(console.log)
}

console.log("Loading account database file...")

const accountsFilePath = "accounts.json"
const accountsDatabase = await loadAccountsFile()
onProcessExit(flushAccountsFile)

await initialActionPrompt()

// await showAccountsList().catch(console.log)
