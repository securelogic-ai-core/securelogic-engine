import { Resend } from "resend";
import { getSubscribers } from "../storage/subscriberStore";
import { recordDelivery } from "../storage/deliveryStore";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendNewsletter(issue:any){

  const subscribers = getSubscribers();

  for (const sub of subscribers){

    try{

      await resend.emails.send({
        from: process.env.NEWSLETTER_FROM_EMAIL!,
        to: sub.email,
        subject: issue.title,
        html: issue.content_html
      });

      recordDelivery(issue.id, sub.email, "sent");

    }catch(err){

      recordDelivery(issue.id, sub.email, "failed");

    }

  }
}
