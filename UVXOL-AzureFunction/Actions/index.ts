import { AzureFunction, Context, HttpRequest } from "@azure/functions"
import * as db from "../Shared/db"

const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
    context.log('Actions request');

    const id = req.query.id ? parseInt(req.query.id) : null;

    let body = {}

    if (req.method === "GET") {
        if (id != null) {
            body = 
                await db.getAction(id)
                    .then(res => res.recordset[0])
                    .catch(err => { context.log(err); return { err }});
        } else {
            body = await db.getActions()
                .then(res => res.recordset)
                .catch(err => { context.log(err); return { err }});
        }
    } else if (req.method === "POST") {
        body = await db.insertAction(
            req.body.location, 
            req.body.type, 
            req.body.name,
            req.body.filePath
        ).then(() => ({message: "success"}))
        .catch(err => { context.log(err); return { err }});
    } else if (req.method === "DELETE") {
        body = await db.deleteAction(id)
            .then(() => ({ message: "success" }))
            .catch(err => ({err}))
    }

    context.res = {
        body: JSON.stringify(body),
        headers: {
            'Content-Type': "application/json"
        }
    };
};

export default httpTrigger;
